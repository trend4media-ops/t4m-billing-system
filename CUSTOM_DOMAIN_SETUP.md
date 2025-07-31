# 🌐 Custom Domain Setup Guide

Komplette Anleitung für die Einrichtung von Custom Domains für das trend4media System.

## 📋 Domain Übersicht

- **Frontend**: `app.trend4media.com` → Vercel Next.js App
- **Backend**: `api.trend4media.com` → Heroku NestJS API

---

## 🎨 Frontend Domain Setup (app.trend4media.com)

### Schritt 1: Vercel Domain Configuration

1. **Vercel Dashboard öffnen**
   ```
   https://vercel.com/dashboard
   ```

2. **Projekt auswählen**
   - Navigiere zu: `trend4media-frontend` Projekt
   - Klicke auf das Projekt

3. **Domain hinzufügen**
   ```
   Settings → Domains → Add Domain
   Domain: app.trend4media.com
   ```

4. **CNAME Record von Vercel kopieren**
   ```
   Vercel zeigt an:
   Name: app
   Value: cname.vercel-dns.com (Beispiel)
   ```

### Schritt 2: DNS Configuration

#### Bei Cloudflare (empfohlen):
```
Record Type: CNAME
Name: app
Target: [Vercel CNAME Value]
Proxy Status: Proxied (Orange Cloud)
TTL: Auto
```

#### Bei anderen DNS Providern:
```
Record Type: CNAME
Name: app
Value: [Vercel CNAME Value]
TTL: 300 (5 minutes)
```

### Schritt 3: SSL/HTTPS Verification

1. **Automatische SSL Aktivierung**
   - Vercel aktiviert automatisch Let's Encrypt SSL
   - Warten auf Domain Verification (5-10 Minuten)

2. **HTTPS Redirect**
   ```
   Vercel Settings → Functions & Middleware
   Force HTTPS: Enabled
   ```

---

## 🔧 Backend Domain Setup (api.trend4media.com)

### Schritt 1: Heroku Domain Configuration

1. **Heroku Dashboard öffnen**
   ```
   https://dashboard.heroku.com
   ```

2. **App auswählen**
   - Navigiere zu: `trend4media-backend-prod`
   - Settings Tab

3. **Domain hinzufügen**
   ```
   Settings → Domains and certificates
   Add domain: api.trend4media.com
   ```

4. **DNS Target von Heroku kopieren**
   ```
   Heroku zeigt an:
   DNS Target: stormy-forest-1234.herokudns.com (Beispiel)
   ```

### Schritt 2: DNS Configuration

#### Bei Cloudflare:
```
Record Type: CNAME  
Name: api
Target: [Heroku DNS Target]
Proxy Status: Proxied (Orange Cloud)
TTL: Auto
```

#### Bei anderen DNS Providern:
```
Record Type: CNAME
Name: api  
Value: [Heroku DNS Target]
TTL: 300 (5 minutes)
```

### Schritt 3: SSL Certificate

1. **Automatische SSL Aktivierung**
   ```bash
   # SSL wird automatisch von Heroku bereitgestellt
   # ACM (Automated Certificate Management)
   ```

2. **SSL Status prüfen**
   ```bash
   heroku certs -a trend4media-backend-prod
   ```

---

## 🔄 Environment Variables Update

### Frontend (.env.local)
```bash
# Update API URL to custom domain
NEXT_PUBLIC_API_URL=https://api.trend4media.com
```

### Vercel Environment Variables
```bash
# In Vercel Dashboard → Settings → Environment Variables
NEXT_PUBLIC_API_URL=https://api.trend4media.com
```

### Backend CORS Update
```bash
# Update src/main.ts CORS configuration
origin: process.env.NODE_ENV === 'production' 
  ? ['https://app.trend4media.com'] 
  : ['http://localhost:3000', 'http://localhost:3001']
```

---

## 🧪 Domain Testing & Validation

### DNS Propagation Check
```bash
# Check DNS propagation
nslookup app.trend4media.com
nslookup api.trend4media.com

# Online Tools
# https://dnschecker.org
# https://whatsmydns.net
```

### Frontend Tests
```bash
# Homepage
curl -I https://app.trend4media.com

# Login Page
curl -I https://app.trend4media.com/login

# Expected: 200 Status + HTTPS Headers
```

### Backend Tests
```bash
# Health Check
curl https://api.trend4media.com/auth/health

# Expected Response:
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "service": "trend4media-backend",
  "version": "1.0.0"
}

# API Documentation
curl -I https://api.trend4media.com/api/docs
```

### SSL Certificate Validation
```bash
# Check SSL Certificate
openssl s_client -connect app.trend4media.com:443 -servername app.trend4media.com
openssl s_client -connect api.trend4media.com:443 -servername api.trend4media.com

# Online SSL Checker
# https://www.ssllabs.com/ssltest/
```

---

## 📊 Monitoring & Verification

### Domain Status Dashboard
```bash
# Vercel Domain Status check (app.trend4media.com)
# Heroku Domain Status check (api.trend4media.com)

# Expected Status: "Active" with SSL Certificate
```

### Health Monitoring
```bash
# Automated Health Checks
GET https://api.trend4media.com/auth/health (Every 5 minutes)
GET https://app.trend4media.com (Every 5 minutes)

# Expected: 200 OK Response
```

---

## 🚨 Troubleshooting

### Common Issues

#### DNS Propagation Delays
```bash
# Solution: Wait 5-10 minutes for global propagation
# Check multiple DNS servers
dig @8.8.8.8 app.trend4media.com
dig @1.1.1.1 api.trend4media.com
```

#### SSL Certificate Issues
```bash
# Vercel: SSL is automatic, wait for domain verification
# Heroku: Enable ACM if not automatic
heroku certs:auto:enable -a trend4media-backend-prod
```

#### CORS Errors
```bash
# Update backend CORS to include new frontend domain
# Redeploy backend after CORS update
```

#### Environment Variable Issues
```bash
# Ensure NEXT_PUBLIC_API_URL points to custom domain
# Redeploy frontend after environment update
```

---

## ✅ Success Checklist

### Pre-Setup
- [ ] Domain ownership verified
- [ ] DNS Provider access confirmed
- [ ] Vercel/Heroku accounts accessible

### Frontend Domain (app.trend4media.com)
- [ ] Domain added in Vercel
- [ ] CNAME record configured at DNS provider
- [ ] DNS propagation completed (5-10min)
- [ ] SSL certificate active (Let's Encrypt)
- [ ] HTTPS redirect working
- [ ] Environment variables updated

### Backend Domain (api.trend4media.com)  
- [ ] Domain added in Heroku
- [ ] CNAME record configured at DNS provider
- [ ] DNS propagation completed (5-10min)
- [ ] SSL certificate active (ACM)
- [ ] CORS updated for new frontend domain
- [ ] Health check endpoint accessible

### Final Testing
- [ ] https://app.trend4media.com → Frontend loads
- [ ] https://app.trend4media.com/login → Login page accessible
- [ ] https://api.trend4media.com/auth/health → Returns OK status
- [ ] https://api.trend4media.com/api/docs → Swagger documentation
- [ ] Cross-domain API calls working (Frontend → Backend)
- [ ] Login flow functional with custom domains
- [ ] SSL certificates valid (A+ rating)

---

## 🎯 Final Domain URLs

### Production System
```
Frontend: https://app.trend4media.com
Backend:  https://api.trend4media.com

Login:    https://app.trend4media.com/login
Admin:    https://app.trend4media.com/admin  
Dashboard: https://app.trend4media.com/dashboard

Health:   https://api.trend4media.com/auth/health
API Docs: https://api.trend4media.com/api/docs
```

### Legacy URLs (Redirect)
```
https://trend4media-frontend.vercel.app → https://app.trend4media.com
https://trend4media-backend-prod.herokuapp.com → https://api.trend4media.com
```

---

**Status: ⏳ Ready for Custom Domain Configuration**

**Next Steps:**
1. Configure domains in Vercel & Heroku dashboards
2. Update DNS records at domain provider
3. Wait for propagation (5-10 minutes)
4. Test all endpoints and functionality
5. Update documentation with new URLs 