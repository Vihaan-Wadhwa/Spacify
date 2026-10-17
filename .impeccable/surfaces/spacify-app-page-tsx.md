---
version: 1
slug: "spacify-app-page-tsx"
primary_target: "Spacify/app/page.tsx"
related_targets: ["Spacify/app/start/page.tsx"]
---

# Landing + /start

Scope: `/` (landing, Persuade) and `/start` (interactive project setup, Persuade into Operate). Login is optional until the end of /start.

Audience and job: homeowner-first (see PRODUCT.md). They arrive with a plot and a few needs (or a paper sketch) and want to see their home. Action: start a home. The landing hero asks the setup's first question in working form.

User-pinned (2026-10-12): it should feel like something intelligent is taking in each input while it works, and the finished house is revealed once the backend has built it. /start asks the home (type, BHK, extras) and the plot (width, depth, road side, floors, setbacks, Vastu), then shows the 3–5 best layouts from lib/planner.ts (plus local-AI ideas when Ollama runs). Picking one raises it in 3D, and Continue hands it to the studio.
User-pinned (2026-10-12, second round): recolour to white marble with a gold accent, inspired by veined white-and-grey marble with gold seams and charcoal cabinetry. Approved mock: https://claude.ai/artifact/VVyHTxWLMEbnDs3h9CaPv1

## Direction contract

THESIS: A mind working in marble: a blob of gold liquid glass that takes in every answer and splits into the plans. Each answer condenses as a glass pill with its words, rounds into a bead and flows into the blob (which grows by exactly that volume); while the server plans, it thinks; then it buds into one drop per plan (volume kept), and picking a drop raises that plan as charcoal walls on marble floors with gold wall tops. It refuses the dark SaaS hero and the static form.
OWN-WORLD: White marble ground #f4f3f0 with grey veining and gold seams. Panels are #fbfaf8. Ink is charcoal #1d2025, secondary text #4f545c. Gold #c9a04a fills the primary action and selection, gold-deep #8f6a22 covers small gold text and focus, and gold veins and particles are #b8893a. Walls are charcoal #24272d and #3a3e46. Charcoal sections (#1f2227) carry limewash text. Type: Anek Latin display/UI (width axis), Martian Mono for measurements only. Hairline rules, 2px corners, no cards-as-structure, no glass.
STORY: The visitor sees a plan being read and raised, believes a few answers about their plot are enough, and starts. In /start every answer extends the gold veins and the plan, the server scores layouts, the best is revealed, and they pick and continue.
FIRST VIEWPORT: Landing: marble full-bleed, the liquid blob in the right ~60% looping a sample house (answers flow in, it thinks, splits into four drops, flows back together), headline left in charcoal Anek, the working "What are you building?" trio under it (charcoal outline, gold on hover), "I have a sketch" link, quiet Log in, and a charcoal "Start your home" in the nav. /start: the blob sits centred in the scene on marble, the question panel docks right (a bottom sheet on phones), and the log plus a tabular spec run along the bottom.
FORM: User-pinned direction (intelligent mind + backend reveal) recoloured to the user-pinned marble-and-gold palette; originally fused with rolled grounded candidate 5, seed key 65c6f5ad. Signature interaction (user-approved mock https://claude.ai/artifact/VYMQL58MAtxxsJgFRFhPiT): one liquid object per answer, never swapped; smooth-union necking on merge and split; drops sized r = R/∛n; then the picked plan rises in 3D. Drawn by one WebGL SDF shader (components/start/LiquidMind.tsx). Motion: spring condensation, exponential ease-out; reduced motion jumps to end states.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
