```markdown
# Design System Strategy: The Editorial Lens

## 1. Overview & Creative North Star
**Creative North Star: "The Insightful Curator"**

This design system moves away from the generic "dashboard" look and toward a high-end, editorial feedback experience. The goal is to make a personal statement review feel like receiving a bespoke evaluation from a prestigious institution. 

We achieve this through **The Insightful Curator** philosophy: an aesthetic that prioritizes clarity over clutter, using authoritative typography and a "layered paper" depth model. We break the rigid, modular grid by employing intentional asymmetry—specifically using wide gutters and off-center focal points—to guide the user’s eye through their report like a well-designed broadsheet. This isn't just an automated tool; it is a "third eye" providing a professional, human-centric critique.

---

## 2. Colors & Surface Philosophy
The palette is rooted in deep, academic navies and professional blues, balanced by a sophisticated neutral scale that mimics premium stationery.

### The "No-Line" Rule
To maintain a high-end feel, **1px solid borders are strictly prohibited for sectioning.** Conventional borders create visual noise that distracts from the text. Instead, boundaries must be defined through:
*   **Background Shifts:** Distinguish sections by placing a `surface-container-low` module against a `surface` background.
*   **Tonal Transitions:** Use soft, value-based changes to imply containment.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. We use a "stacked sheet" approach:
*   **Base:** `surface` (#f7fafc) acts as the desk.
*   **Primary Containers:** `surface-container-lowest` (#ffffff) cards represent the "paper" where the most critical insights live.
*   **Sub-modules:** Within a white card, use `surface-container` (#ebeef0) for secondary data like metadata or minor scores.

### The "Glass & Gradient" Rule
Standard corporate apps feel flat. To inject "soul," main CTAs and hero headers should utilize a **Signature Texture**: a subtle linear gradient from `primary` (#002045) to `primary-container` (#1a365d) at a 135-degree angle. Floating navigation or feedback overlays should use **Glassmorphism**: `surface-container-lowest` at 80% opacity with a 20px backdrop-blur.

---

### 3. Typography: The Authoritative Voice
We utilize a pairing of **Manrope** for structural authority and **Inter** for functional precision.

*   **Display & Headlines (Manrope):** These are the "Editorial Voice." High-contrast sizing (e.g., `display-lg` at 3.5rem vs. `headline-sm` at 1.5rem) creates a clear narrative hierarchy. Use `on-surface` (#181c1e) with tight letter-spacing (-0.02em) for a modern corporate punch.
*   **Body & Labels (Inter):** These represent the "Expert Critique." Inter provides maximum readability for long-form feedback. `body-lg` (1rem) is the standard for personal statement text, ensuring it feels respected and legible.
*   **Semantic Accents:** Scores and metrics use the `title-lg` scale but are bolded to act as visual anchors within the text-heavy environment.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are often too "heavy" for a professional feedback service. We move beyond them using the following principles:

*   **The Layering Principle:** Depth is achieved by stacking. A `surface-container-lowest` card sitting on a `surface-container-low` background creates a natural, soft lift.
*   **Ambient Shadows:** If an element must float (e.g., a "Submit" FAB), use an extra-diffused shadow: `Y: 12px, Blur: 32px, Color: on-surface (opacity 6%)`. This mimics natural light.
*   **The "Ghost Border" Fallback:** If accessibility requires a stroke (e.g., in high-contrast modes), use `outline-variant` (#c4c6cf) at **15% opacity**. Never use 100% opaque lines.
*   **The Third-Eye Blur:** To emphasize focus during a "Scanning" or "Analyzing" state, use a backdrop-blur of 12px on the background content, making the active feedback module feel physically closer to the user.

---

## 5. Components

### Cards (The Feedback Modules)
*   **Style:** No borders. Use `surface-container-lowest` for the background and `xl` (0.75rem) roundedness.
*   **Layout:** Forbid divider lines between list items in a card. Use `body-md` spacing (1.5rem vertical gap) to separate points.

### Buttons (The Professional CTA)
*   **Primary:** Gradient of `primary` to `primary-container`. `full` roundedness for a modern, approachable feel.
*   **Secondary:** `surface-container-high` background with `on-primary-fixed-variant` text.
*   **State:** Hover states should involve a subtle scale-up (1.02x) rather than a simple color change.

### The "Third-Eye" Gauges
*   **Visual:** Donut charts for scores. Use a thick stroke (12px) for the progress ring.
*   **Colors:** Success (`on-tertiary-container` - #4bb278), Warning (`Warning Yellow`), Alert (`error` - #ba1a1a).
*   **Metaphor:** Avoid AI sparks. Use a clean, circular "Lens" icon in the center of the gauge to represent the "Third-Eye" perspective.

### Input Fields
*   **Style:** Minimalist. `surface-container-low` background, no border, `md` (0.375rem) roundedness. 
*   **Focus State:** The background shifts to `surface-container-lowest` with a 1px "Ghost Border" using `secondary` (#1960a3) at 40% opacity.

---

## 6. Do’s and Don’ts

### Do
*   **Do** use asymmetrical layouts. Let the personal statement sit on the left (65% width) and the feedback cards sit on the right (35% width) with a wide 48px gutter.
*   **Do** use `tertiary_container` for "Positive Insights" to distinguish them from standard "Success" messages.
*   **Do** embrace white space. If a page feels empty, increase the margin rather than adding a decorative element.

### Don’t
*   **Don’t** use robot, circuit, or "brain" icons. Ssurd is about human-level insight through professional metrics.
*   **Don’t** use a divider line to separate a header from a body. Use a change in font-weight and a 32px vertical gap instead.
*   **Don’t** use pure black (#000000). Always use `on-surface` (#181c1e) to maintain the sophisticated, slightly "ink-on-paper" feel.
*   **Don’t** use standard "Material Blue." Use our primary `primary` (#002045) to ensure the brand feels expensive and authoritative.```