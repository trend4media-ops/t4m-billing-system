import * as admin from 'firebase-admin';
import { Response } from 'express';
import { AuthenticatedRequest } from './middleware/auth';

// Stripe is optional; require dynamically to avoid type issues when not configured
function getStripe(): any | null {
  const key = process.env.STRIPE_API_KEY;
  if (!key) return null;
  // @ts-ignore – dynamic require without types
  const Stripe = require('stripe');
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

const db = admin.firestore();

export async function createCheckoutSession(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const stripe = getStripe();
    if (!stripe) { res.status(400).json({ error: 'Stripe not configured' }); return; }

    const { plan, introDiscount } = (req.body || {}) as { plan?: 'starter'|'pro'|'enterprise'; introDiscount?: boolean };
    if (!plan) { res.status(400).json({ error: 'plan is required' }); return; }

    const priceMap: Record<string, string|undefined> = {
      starter: process.env.STRIPE_PRICE_STARTER,
      pro: process.env.STRIPE_PRICE_PRO,
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE
    };
    const priceId = priceMap[plan];
    if (!priceId) { res.status(400).json({ error: `Price not configured for plan ${plan}` }); return; }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    // Ensure tenant record (owner uid as tenant id for MVP)
    const ownerId = req.user.uid;
    const tenantRef = db.collection('tenants').doc(ownerId);
    const tSnap = await tenantRef.get();
    let customerId = (tSnap.exists ? (tSnap.data()?.stripeCustomerId || '') : '');
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email || undefined,
        metadata: { ownerUserId: ownerId }
      });
      customerId = customer.id;
      await tenantRef.set({
        id: ownerId,
        ownerUserId: ownerId,
        stripeCustomerId: customerId,
        status: 'incomplete',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    const payload: any = {
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/dashboard?sub=success`,
      cancel_url: `${appUrl}/pricing?canceled=1`,
      metadata: { tenantId: ownerId, ownerUserId: ownerId, plan },
      subscription_data: { metadata: { tenantId: ownerId, plan } },
    };
    if (introDiscount && process.env.STRIPE_COUPON_INTRO50) {
      payload.discounts = [{ coupon: process.env.STRIPE_COUPON_INTRO50 }];
    }
    const session = await stripe.checkout.sessions.create(payload);

    res.status(200).json({ success: true, url: session.url });
  } catch (e:any) {
    console.error('createCheckoutSession failed', e);
    res.status(500).json({ error: 'Failed to create checkout', details: e.message });
  }
}

export async function getPortalLink(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const stripe = getStripe();
    if (!stripe) { res.status(400).json({ error: 'Stripe not configured' }); return; }

    const tenantId = req.user.uid; // MVP: owner == tenant
    const t = await db.collection('tenants').doc(tenantId).get();
    if (!t.exists || !t.data()?.stripeCustomerId) { res.status(400).json({ error: 'No Stripe customer linked' }); return; }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const portal = await stripe.billingPortal.sessions.create({
      customer: t.data()!.stripeCustomerId,
      return_url: `${appUrl}/dashboard`
    });
    res.status(200).json({ success: true, url: portal.url });
  } catch (e:any) {
    console.error('getPortalLink failed', e);
    res.status(500).json({ error: 'Failed to create portal link', details: e.message });
  }
}

export async function stripeWebhook(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const stripe = getStripe();
    if (!stripe) { res.status(400).json({ error: 'Stripe not configured' }); return; }

    const sig = (req as any).headers['stripe-signature'] as string | undefined;
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: any = null;
    try {
      if (secret && sig) {
        // If raw body is available use it; else fallback to parsed body
        const rawBody = (req as any).rawBody || JSON.stringify(req.body);
        event = stripe.webhooks.constructEvent(rawBody, sig, secret);
      } else {
        event = req.body; // fallback for non-verified dev
      }
    } catch (err:any) {
      console.error('Webhook signature verification failed', err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    // Store last event info for health
    try {
      await db.doc('system/stripeWebhook').set({
        lastType: event?.type || null,
        lastEventAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch {}

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const tenantId = session.metadata?.tenantId;
        const subscriptionId = session.subscription;
        const customerId = session.customer;
        if (tenantId) {
          await db.collection('tenants').doc(tenantId).set({
            stripeCustomerId: customerId,
            subscriptionId: subscriptionId,
            status: 'active',
            plan: session.metadata?.plan || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object;
        const tenantId = sub.metadata?.tenantId;
        if (tenantId) {
          await db.collection('tenants').doc(tenantId).set({
            subscriptionId: sub.id,
            status: sub.status,
            plan: sub.items?.data?.[0]?.price?.nickname || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const tenantId = sub.metadata?.tenantId;
        if (tenantId) {
          await db.collection('tenants').doc(tenantId).set({
            status: 'canceled',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        const tenantId = inv.subscription_details?.metadata?.tenantId || inv.lines?.data?.[0]?.metadata?.tenantId;
        if (tenantId) {
          await db.collection('tenants').doc(tenantId).set({
            status: 'past_due',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        break;
      }
      default:
        break;
    }

    res.status(200).json({ received: true });
  } catch (e:any) {
    console.error('stripeWebhook failed', e);
    res.status(500).json({ error: 'Webhook failed', details: e.message });
  }
}

export async function listInvoices(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const stripe = getStripe();
    if (!stripe) { res.status(400).json({ error: 'Stripe not configured' }); return; }

    const tenantId = req.user.uid; // MVP owner
    const tSnap = await db.collection('tenants').doc(tenantId).get();
    const customerId = tSnap.exists ? (tSnap.data()?.stripeCustomerId as string) : '';
    if (!customerId) { res.status(200).json({ success: true, items: [] }); return; }

    const invs = await stripe.invoices.list({ customer: customerId, limit: 24 });
    const items = (invs.data || []).map((i: any) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      currency: i.currency,
      amount_due: i.amount_due,
      amount_paid: i.amount_paid,
      hosted_invoice_url: i.hosted_invoice_url,
      invoice_pdf: i.invoice_pdf,
      created: i.created,
      period_start: i.lines?.data?.[0]?.period?.start || null,
      period_end: i.lines?.data?.[0]?.period?.end || null,
    }));
    res.status(200).json({ success: true, items });
  } catch (e:any) {
    console.error('listInvoices failed', e);
    res.status(500).json({ error: 'Failed to list invoices', details: e.message });
  }
}

export async function getWebhookHealth(_req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const doc = await db.doc('system/stripeWebhook').get();
    const data = doc.exists ? doc.data() : {};
    res.status(200).json({ success: true, configured: !!process.env.STRIPE_WEBHOOK_SECRET, lastType: data?.lastType || null, lastEventAt: data?.lastEventAt || null });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to load webhook health', details: e.message });
  }
} 