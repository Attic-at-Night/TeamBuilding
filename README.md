# TeamBuilding

Minimal web app that supports a TV-style host screen with a QR code and a mobile join flow.

## Run locally

```bash
npm install
npm start
```

Then open:
- `http://localhost:3000/` on the TV/browser host screen
- Scan the QR code from a mobile device to join the same session

The host page shows detected connection details (IP, adapter name, and SSID when available) to help confirm which network is being used.
