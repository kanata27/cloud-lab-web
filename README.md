# cloud-lab-web

Minimal static Nginx site for the AWS ALB / Target Group / Auto Scaling lab.

## Local test

```bash
docker build -t cloud-lab-web:v1 .
docker run --rm -p 8080:80 --name cloud-lab-test cloud-lab-web:v1
```

Open http://localhost:8080

## Files

- `index.html` — page markup
- `style.css` — desktop/mobile responsive layout
- `assets/hero.jpg` — hero photo cropped from the supplied visual reference
- `Dockerfile` — Nginx image

test change