# Local Outlook Icon Design

## Chosen Direction

Use the approved concept 3: a white envelope closed by a centered teal padlock clasp. The envelope and lock read as one unified symbol rather than two overlapping objects.

## Visual System

- Shape: compact rounded-square application tile with transparent outer corners.
- Background: charcoal `#202A32`.
- Envelope: near-white `#F7FAFC`, using broad geometry and no thin strokes.
- Lock: teal `#21B8A6`, centered on the lower envelope edge.
- Keyhole: charcoal, large enough to survive 16 px rendering.
- Style: flat, geometric, professional, and security-focused.
- Avoid: text, Microsoft or Outlook marks, gradients, glow, fine detail, shields, and floating decorative elements.

## Size Behavior

- `48-256 px`: show the complete envelope flap and lock body.
- `32 px`: simplify the flap intersections and preserve a large lock silhouette.
- `16 px`: prioritize the white envelope block, teal clasp, and dark keyhole.

## Deliverables

- Editable vector source: `desktop/local-outlook-mail-icon.svg`.
- Multi-resolution Windows icon: `desktop/local-outlook-mail.ico`.
- Application favicon/window image under `public/`.
- Recompiled desktop launcher: `C:\Users\28589\Desktop\本地Outlook取件台.exe`.

## Integration

- Compile the WinExe with `/win32icon:desktop/local-outlook-mail.ico`.
- Add the icon to the local application HTML so the Edge app window can use the same visual identity.
- Keep the launcher path and D-drive runtime/data layout unchanged.

## Verification

- Inspect the icon at 256, 48, 32, and 16 px.
- Confirm the desktop EXE contains the icon resource.
- Launch the EXE and verify the local application still starts from `D:\LocalOutlookMailConsole`.
- Run the full automated test suite.
