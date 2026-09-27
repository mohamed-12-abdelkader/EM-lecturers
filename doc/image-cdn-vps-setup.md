# Image CDN (Express static) — VPS setup

Images are stored under `uploads/` on disk and served publicly at **`/cdn/...`** (images only: jpeg, png, webp, gif). PDFs and other files stay on `/uploads` and are **not** available via `/cdn`.

All image upload helpers (`uploadToCloudinary` / `saveLocalImageFile`, user avatars, tenant images, course images, exam images, etc.) now store and return **`/cdn/<category>/...`** paths. API responses also rewrite legacy `/uploads/...jpg` image URLs to `/cdn/...`.

## App env

```env
IMAGE_CDN_PUBLIC_PREFIX=/cdn
IMAGE_CDN_MAX_AGE_SECONDS=2592000
# Public API base used when returning absolute image URLs:
PRODUCTION_URL=https://api.em-online.online
BASE_URL=https://api.em-online.online
```

Restart the Node process after changing env (`pm2 restart emlec`).

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/cdn/images` | admin / teacher JWT | Upload (`multipart` field `image`, optional `category`) |
| `POST` | `/api/cdn/upload` | admin / teacher JWT | Same, field name `file` |
| `GET` | `/cdn/<category>/<file>.jpg` | public | Fetch image |

Example upload:

```bash
curl -X POST "https://api.em-online.online/api/cdn/images" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "X-Tenant-Subdomain: default" \
  -F "image=@./photo.jpg" \
  -F "category=general"
```

Response includes `data.path` like `/cdn/general/….jpg` and absolute `data.url`.

Categories (folder under `uploads/`): `users`, `teachers`, `courses`, `lessons`, `questions`, `general`, `avatars`, `social`, `chat`, `academy`, `leagues`, `packages`.

## VPS (recommended): nginx serves `/cdn` from disk

Serving images from nginx is faster than proxying every byte through Node. Keep Express `/cdn` as a fallback.

On the API host (`api.em-online.online`), edit the site (e.g. `/etc/nginx/sites-enabled/api.emlec`) and add **before** the catch-all `location /`:

```nginx
# Image CDN — disk only, no PDF / arbitrary files
location ^~ /cdn/ {
    alias /home/alwyzon/EM-lecturers/uploads/;

    # Only allow image extensions
    location ~* ^/cdn/.+\.(jpe?g|png|gif|webp)$ {
        alias /home/alwyzon/EM-lecturers/uploads/;
        # nginx nested alias is awkward — prefer the map approach below
    }

    types {
        image/jpeg jpg jpeg;
        image/png  png;
        image/webp webp;
        image/gif  gif;
    }
    default_type application/octet-stream;

    # Reject non-images: if type is not image/*, 404
    if ($request_filename !~* \.(jpe?g|png|gif|webp)$) {
        return 404;
    }

    expires 30d;
    add_header Cache-Control "public, max-age=2592000, immutable" always;
    add_header Cross-Origin-Resource-Policy "cross-origin" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header X-Content-Type-Options "nosniff" always;

    try_files $uri =404;
    access_log off;
}
```

**Cleaner nginx pattern** (recommended — rewrite `/cdn/` → uploads root):

```nginx
location ^~ /cdn/ {
    # /cdn/courses/x.jpg → /home/.../uploads/courses/x.jpg
    rewrite ^/cdn/(.*)$ /$1 break;
    root /home/alwyzon/EM-lecturers/uploads;

    # Block path traversal / non-images
    if ($uri !~* \.(jpe?g|png|gif|webp)$) { return 404; }

    expires 30d;
    add_header Cache-Control "public, max-age=2592000, immutable" always;
    add_header Cross-Origin-Resource-Policy "cross-origin" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header X-Content-Type-Options "nosniff" always;

    try_files $uri =404;
    access_log off;
}
```

Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Optional: dedicated CDN host

```nginx
server {
    listen 443 ssl http2;
    server_name cdn.em-online.online;
    # ssl_certificate ... (certbot)

    root /home/alwyzon/EM-lecturers/uploads;

    location / {
        if ($uri !~* \.(jpe?g|png|gif|webp)$) { return 404; }
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable" always;
        add_header Access-Control-Allow-Origin "*" always;
        try_files $uri =404;
    }
}
```

Point DNS `cdn.em-online.online` → the VPS, then set:

```env
BASE_URL=https://cdn.em-online.online
# or keep API base and store relative /cdn/... paths (clients use API host)
```

Uploads still go through the API (`POST /api/cdn/images`); only **reads** use the CDN host.

## Fallback: proxy `/cdn` to Express

If you prefer Node to serve files:

```nginx
location ^~ /cdn/ {
    proxy_pass http://127.0.0.1:8085;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Permissions

```bash
# App user must read/write uploads
sudo chown -R alwyzon:alwyzon /home/alwyzon/EM-lecturers/uploads
chmod -R u+rwX,g+rX /home/alwyzon/EM-lecturers/uploads
```

## Verify

```bash
# Upload (with token)
curl -sS -X POST "https://api.em-online.online/api/cdn/images" \
  -H "Authorization: Bearer <TOKEN>" -F "image=@./test.png" -F "category=general"

# Public GET (use path from response)
curl -sSI "https://api.em-online.online/cdn/general/<filename>.png"
# Expect: 200, Content-Type: image/png, Cache-Control: public, max-age=...
```
