# Spacify — Home Design Platform

A browser-based 3D home design tool. Add rooms, customise materials, walk through your layout, and get AI-powered design suggestions — all from a single HTML file with no backend required.

---

## Features

**3D Model Builder**
- Add rooms by type (bedroom, kitchen, living room, etc.) with custom dimensions
- Real-time wall colour picker with presets and full hex input
- 6 flooring options — White Marble, Beige Tiles, Dark Wood, Light Wood, Grey Granite, Vitrified
- Adjustable ceiling height per room (8–16 ft)
- Orbit, pan, and zoom the 3D scene with mouse controls
- Export a PNG snapshot of the 3D view

**2D Floor Plan**
- Scaled top-down canvas view of your layout
- Door arc indicators and room dimension labels
- North direction marker
- Export the plan as a PNG

**First-Person Walkthrough**
- Enter walkthrough mode to explore your design at eye level
- WASD / arrow keys to move, mouse to look, Shift to sprint
- Press Esc to exit back to the 3D orbit view

**AI Design Assistant** *(Phase 3)*
- Powered by n8n + Gemini API
- Describe a room in natural language and get layout and decor suggestions
- Free to run — uses Gemini's free tier via a self-hosted n8n webhook

---

## Tech Stack

| Layer | Tool |
|---|---|
| 3D Rendering | Three.js (CDN, no build step) |
| 2D Floor Plan | HTML Canvas API |
| AI Assistant | n8n · Gemini API |
| Runtime | Single HTML file — no framework, no backend |

---

## Getting Started

No install needed. Just open `spacify-3d.html` in a browser.

```bash
git clone https://github.com/your-username/spacify.git
cd spacify
open spacify-3d.html
```

For the AI assistant, you'll need an n8n instance (local or cloud) and a Gemini API key. Set up a webhook workflow in n8n and point the assistant endpoint in the code to your webhook URL.

---

## Project Structure

```
spacify/
├── spacify.html        # Landing / home page
├── spacify-3d.html     # Main design tool
└── README.md
```

---

## Roadmap

- [x] 3D room builder with materials
- [x] 2D floor plan view
- [x] First-person walkthrough
- [x] PNG export (3D + 2D)
- [ ] AI design assistant (Phase 3)
- [ ] Furniture placement
- [ ] Multi-floor support
- [ ] Save / load projects (JSON)

---

## License

MIT
