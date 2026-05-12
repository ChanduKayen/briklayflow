---
name: Constructive Finance
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#45464d'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#2a1700'
  on-tertiary-container: '#b87500'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-lg:
    fontFamily: Manrope
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  data-mono:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  margin-mobile: 16px
  margin-desktop: 32px
  gutter: 16px
  stack-sm: 4px
  stack-md: 12px
  stack-lg: 24px
---

## Brand & Style

The design system is engineered for the high-stakes environment of construction finance, where clarity, trust, and efficiency are paramount. The visual language balances industrial stability with modern fintech elegance, moving away from the cluttered interfaces traditional to the sector. 

The style is defined as **Corporate Modern with a Minimalist focus**. It prioritizes high-legibility data displays and frictionless mobile workflows. By utilizing a "content-first" approach, the design system ensures that project managers and subcontractors can navigate complex payment milestones and compliance documentation with zero cognitive overhead. The atmosphere is precise and institutional, yet approachable enough for field use.

## Colors

The color palette is anchored in **Deep Navy**, a choice that evokes the structural integrity of the construction industry and the security of a financial institution. This is complemented by a "Success-First" philosophy, where **Emerald Green** is used strategically to signal completed milestones and approved draws, providing immediate positive reinforcement.

**Amber** serves as the primary diagnostic color, highlighting unlinked records or flagged transactions that require human intervention without causing undue alarm. The background uses a specific **Soft Grey-White** to reduce screen glare during outdoor field use, while high-contrast neutrals ensure that secondary metadata remains legible under various lighting conditions.

## Typography

Typography in this design system is optimized for "dense data legibility." **Manrope** is utilized for headlines to provide a modern, structural feel that differentiates sections clearly. **Inter** is the workhorse for body text and interface elements, chosen for its exceptional x-height and clarity in complex tables.

A specific **Data Mono** style is introduced for currency and transaction IDs to ensure characters don't jump when numbers change and to assist in quick visual scanning of financial columns. Hierarchy is maintained through weight rather than just size, ensuring that mobile screens remain uncluttered while preserving the information density required by professional users.

## Layout & Spacing

The layout philosophy follows a **Fluid 8pt Grid** system. On mobile, the design system utilizes a 4-column grid with 16px side margins to maximize the touch target area for interactive elements. On desktop, this scales to a 12-column fixed-max-width layout (1280px) to prevent data tables from becoming unreadably wide.

Spacing is handled through "Logical Stacks." Small increments (4px, 8px) are reserved for related metadata, while larger gaps (24px+) define distinct project phases or transaction blocks. This rhythmic spacing ensures that even on smaller screens, the content has room to "breathe," preventing the "spreadsheet fatigue" common in legacy construction software.

## Elevation & Depth

This design system uses **Tonal Layering** combined with **Ambient Shadows** to communicate hierarchy. Surfaces are never truly flat; instead, they sit on a background of `#F8FAFC`. 

- **Level 0 (Background):** The base canvas.
- **Level 1 (Cards/Containers):** Raised slightly with a subtle, 4% opacity navy shadow (Y: 2px, Blur: 4px). This is the primary container for list items and data groups.
- **Level 2 (Modals/Overlays):** Used for transaction details or approval prompts, featuring a more pronounced 8% opacity shadow (Y: 8px, Blur: 16px) to focus the user's attention.

Backdrop blurs are used sparingly on mobile navigation bars to maintain context of the scroll position without sacrificing legibility.

## Shapes

The shape language is defined by **Medium Roundedness**. A standard radius of 8px (0.5rem) is applied to all primary containers, buttons, and input fields. This specific radius is chosen to soften the "industrial" feel of the system, making the professional tool feel more modern and user-friendly.

Smaller elements like checkboxes or status tags use a slightly tighter radius (4px) to maintain visual balance, while large-scale "Action Sheets" on mobile utilize 16px top-rounded corners to signal they are temporary overlays.

## Components

### Buttons
Primary actions use the Deep Navy background with white text, featuring a subtle hover state that lightens the navy. Secondary actions use an outlined style with a 1px border in a mid-tone neutral. "Approve" buttons specifically utilize the Emerald Green to provide a distinct visual "go" signal.

### Status Badges
Badges are critical for this design system. They follow a "Soft Fill" pattern: a desaturated background color with a high-contrast text color (e.g., a light emerald background with dark emerald text). This ensures they are visible but do not distract from the primary data.

### Input Fields
Inputs feature a 1px border in a light neutral, which transitions to the Deep Navy on focus. Labels are positioned above the field in the `label-caps` typography style to ensure the user always knows what data is being entered, even when the field is filled.

### Data Cards (Mobile-First)
In place of wide tables on mobile, the design system uses "Transaction Cards." Each card summarizes a payment with the amount in `data-mono`, the status badge in the top right, and the project name in a bold `body-lg`.

### Progress Steppers
A custom vertical stepper component is used for payment milestones, showing the "Path to Paid" status. Completed steps are marked with an Emerald Green checkmark, while active steps feature a Deep Navy pulsing ring.