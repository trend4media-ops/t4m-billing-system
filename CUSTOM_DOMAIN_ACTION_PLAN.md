# 🎯 Custom Domain Setup - Action Plan

Konkrete Schritte zur Aktivierung der Custom Domains für das trend4media System.

## 🚀 Sofort zu erledigende Schritte

### 1️⃣ Vercel Frontend Domain Setup (5 Minuten)

#### **Schritt 1.1: Vercel Dashboard**
```
1. Öffne: https://vercel.com/dashboard
2. Wähle Projekt: "trend4media-frontend"
3. Navigiere zu: Settings → Domains
4. Klicke: "Add Domain"
5. Eingabe: app.trend4media.com
6. Klicke: "Add"
```

#### **Schritt 1.2: CNAME Record kopieren**
```
Vercel zeigt dir an:
📋 Name: app
📋 Value: cname.vercel-dns.com (oder ähnlich)

⚠️ WICHTIG: Kopiere diesen CNAME Value für Schritt 3!
```

### 2️⃣ Heroku Backend Domain Setup (5 Minuten)

#### **Schritt 2.1: Heroku Dashboard**
```
1. Öffne: https://dashboard.heroku.com
2. Wähle App: "trend4media-backend-prod"
3. Navigiere zu: Settings
4. Scrolle zu: "Domains and certificates"
5. Klicke: "Add domain"
6. Eingabe: api.trend4media.com
7. Klicke: "Save changes"
```

#### **Schritt 2.2: DNS Target kopieren**
```
Heroku zeigt dir an:
📋 DNS Target: something-1234.herokudns.com (oder ähnlich)

⚠️ WICHTIG: Kopiere diesen DNS Target für Schritt 3!
```

### 3️⃣ DNS Records beim Domain Provider (10 Minuten)

#### **Bei Cloudflare (empfohlen):**
```
1. Öffne Cloudflare Dashboard
2. Wähle Domain: trend4media.com
3. Navigiere zu: DNS → Records

Record 1 (Frontend):
- Type: CNAME
- Name: app
- Target: [Vercel CNAME Value aus Schritt 1.2]
- Proxy Status: ✅ Proxied (Orange Cloud)
- TTL: Auto
- Klicke: Save

Record 2 (Backend):
- Type: CNAME  
- Name: api
- Target: [Heroku DNS Target aus Schritt 2.2]
- Proxy Status: ✅ Proxied (Orange Cloud)
- TTL: Auto
- Klicke: Save
```

#### **Bei anderen Providern (GoDaddy, Namecheap, etc.):**
```
Record 1 (Frontend):
- Type: CNAME
- Name: app
- Value: [Vercel CNAME Value]
- TTL: 300

Record 2 (Backend):
- Type: CNAME
- Name: api
- Value: [Heroku DNS Target]
- TTL: 300
```

### 4️⃣ Environment Variables Update (3 Minuten)

#### **Schritt 4.1: Vercel Environment Variables**
```
1. Vercel Dashboard → Settings → Environment Variables
2. Suche: NEXT_PUBLIC_API_URL
3. Editiere Wert: https://api.trend4media.com
4. Klicke: Save
5. Triggere Rebuild: Deployments → Redeploy
```

#### **Schritt 4.2: Backend neu deployen**
```bash
# Die CORS-Updates sind bereits im Code
# Einfach das Backend neu deployen:
git push origin main

# Oder manuell:
heroku restart -a trend4media-backend-prod
```

### 5️⃣ DNS Propagation warten (5-10 Minuten)

#### **Propagation Check:**
```bash
# Terminal Commands zum Testen
nslookup app.trend4media.com
nslookup api.trend4media.com

# Online Tools (Browser):
# https://dnschecker.org
# https://whatsmydns.net
```

#### **Erwartete Ausgabe:**
```
app.trend4media.com zeigt auf: Vercel IP
api.trend4media.com zeigt auf: Heroku IP
```

---

## ✅ Testing & Validation (5 Minuten)

### **Frontend Tests:**
```bash
# 1. Homepage Test
curl -I https://app.trend4media.com
# Expected: 200 OK + HTTPS Headers

# 2. Login Page Test  
curl -I https://app.trend4media.com/login
# Expected: 200 OK

# 3. Browser Test
# Öffne: https://app.trend4media.com
# Expected: Login-Seite lädt
```

### **Backend Tests:**
```bash
# 1. Health Check
curl https://api.trend4media.com/auth/health
# Expected: {"status":"ok","timestamp":"...","service":"trend4media-backend","version":"1.0.0"}

# 2. API Documentation
curl -I https://api.trend4media.com/api/docs
# Expected: 200 OK

# 3. Browser Test
# Öffne: https://api.trend4media.com/api/docs
# Expected: Swagger UI lädt
```

### **SSL Certificate Check:**
```bash
# SSL Test
openssl s_client -connect app.trend4media.com:443 -servername app.trend4media.com
openssl s_client -connect api.trend4media.com:443 -servername api.trend4media.com

# Online SSL Test:
# https://www.ssllabs.com/ssltest/
```

### **End-to-End Login Test:**
```
1. Öffne: https://app.trend4media.com
2. Eingabe: admin@trend4media.com / AdminPassword123!
3. Expected: Redirect zu https://app.trend4media.com/admin
4. API Calls sollten zu https://api.trend4media.com gehen
```

---

## 🚨 Troubleshooting

### **Problem: DNS Records nicht verfügbar**
```bash
# Solution: Warten (bis zu 24h für globale Propagation)
# Quick Fix: Flush DNS Cache
# Windows: ipconfig /flushdns
# Mac: sudo dscacheutil -flushcache
# Linux: sudo systemctl flush-dns
```

### **Problem: SSL Certificate Error**
```bash
# Vercel: SSL ist automatisch, warte 5-10 Minuten
# Heroku: ACM ist automatisch aktiviert
# Check: heroku certs -a trend4media-backend-prod
```

### **Problem: CORS Errors**
```bash
# Backend bereits aktualisiert, neu deployen:
git push origin main
# Oder: heroku restart -a trend4media-backend-prod
```

### **Problem: Frontend lädt alte API URL**
```bash
# Environment Variable prüfen:
# Vercel Dashboard → Settings → Environment Variables
# NEXT_PUBLIC_API_URL = https://api.trend4media.com
# Dann: Redeploy triggern
```

---

## 📋 Success Checklist

### ✅ Domains konfiguriert
- [ ] Vercel: `app.trend4media.com` hinzugefügt
- [ ] Heroku: `api.trend4media.com` hinzugefügt
- [ ] DNS: CNAME Records erstellt
- [ ] Environment: `NEXT_PUBLIC_API_URL` aktualisiert

### ✅ DNS & SSL aktiv
- [ ] DNS Propagation abgeschlossen (5-10 min)
- [ ] SSL Certificates aktiv (automatisch)
- [ ] HTTPS Redirect funktioniert
- [ ] CORS erlaubt Cross-Domain Requests

### ✅ Funktionalität getestet
- [ ] Frontend: `https://app.trend4media.com` lädt
- [ ] Backend: `https://api.trend4media.com/auth/health` antwortet
- [ ] Login: Admin/Manager Login funktioniert
- [ ] API: Cross-Domain Requests erfolgreich

---

## 🎯 Final Status Report

Nach erfolgreichem Setup bitte bestätigen:

```
✅ Frontend live unter: https://app.trend4media.com
✅ Backend live unter: https://api.trend4media.com
✅ Login getestet: Admin + Manager funktional
✅ SSL Zertifikate: A+ Rating
✅ DNS Propagation: Global verfügbar
```

**Geschätzte Gesamtzeit: 15-20 Minuten + DNS Propagation**

---

**Status: 🚀 Bereit für Custom Domain Aktivierung**

**Next Steps nach Abschluss:**
1. Legacy URLs können als Redirects konfiguriert werden
2. Monitoring Setup für Custom Domains
3. Performance Tests mit neuen URLs
4. Dokumentation aktualisieren mit finalen URLs 