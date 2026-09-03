# Send Connection Request RPC

## Summary

Add `profile.person.connect`. Reuse the current temporary person-profile tab, background queue, content-script queue, error system, `waitFor`, `realClick`, and visibility checks. Always close the temporary tab.

## Public Interface

- Arguments: `{ memberId: string, note?: string }`
- Result: `{ memberId: string, status: "sent" | "already_connected" | "already_pending" }`
- Treat a blank note as no note. Keep nonblank note text unchanged.
- Reject an invalid member ID or a note longer than 300 characters with `BAD_ARGS`. Do not cut the note.
- Add the command to the TypeScript command types and both Django command lists in `wire.py`.

## Development Workflow

Each step must work through the same RPC path:

```text
Backend development console
-> Django RPC
-> WebSocket
-> extension background worker
-> person-profile content script
-> LinkedIn UI
-> structured result
-> backend development console
```

- Add `profile.person.connect` to the full RPC path in Step 1.
- Use the backend development console for all tests. Do not add a browser-console interface.
- Keep early steps read-only. The command must not send an invitation before Step 5.
- Return a structured development result that proves the behavior of the current step.
- Keep `types.ts` matched to the current request and result.
- Add the command to `wire.py` in Step 1. Later result changes do not need a `wire.py` change because `CommandSuccess.result` is currently `Any`.
- Build and reload the extension after each step.
- Call the command from the backend development console, review its result, and stop before the next step.

## Implementation Steps

### 1. Add the inspection RPC

- Add `profile/person/connect.ts`.
- Register `profile.person.connect` in `types.ts`.
- Add the command to the `Commands` literal and `is_command` in `wire.py`.
- Add the background route and person-profile handler.
- Open the temporary person-profile tab and run the inspector through the existing person-profile content script.
- Close the temporary tab after the result or an error.
- Do not click a LinkedIn control.
- Read each visible top-card control's tag, text, role, `aria-label`, `href`, `componentkey`, disabled state, and expanded state.
- Read the visible relationship text.
- Return this development result:

```text
{
  memberId,
  stage: "inspection",
  url,
  root: { found, method },
  actions,
  relationshipTexts
}
```

- Call the RPC for direct Connect, More, pending, and connected profiles.
- Stop when the result contains a reliable root and useful action evidence for each profile.

### 2. Add top-card detection

- Keep the same RPC path and do not click a control.
- Detect a direct Connect control, a visible Pending control, an available More control, or a visible `1st` fallback.
- Return this development result:

```text
{
  memberId,
  stage: "top_card_detection",
  state,
  evidence
}
```

- Use `connect_direct`, `pending_direct`, `more_available`, `connected_fallback`, or `unknown` as the state.
- Include the raw action evidence when the state is `unknown`.
- Update the TypeScript result type before the backend test.
- Stop when all supplied profile states give the correct result.

### 3. Add More menu detection

- Click only the visible More control in the top card.
- Wait for the visible menu that the click opens.
- Inspect only the items in that menu.
- Detect Connect, Withdraw invitation, or Remove connection.
- Close the menu after inspection.
- Do not send an invitation.
- Return this development result:

```text
{
  memberId,
  stage: "menu_detection",
  state,
  menuItems
}
```

- Use `connect_direct`, `connect_more`, `already_pending`, `already_connected`, or `unavailable` as the state.
- Include all observed menu-item names when detection fails.
- Update the TypeScript result type before the backend test.
- Stop when direct Connect and More > Connect give the correct action state.

### 4. Add dialog inspection

- Click the detected Connect control.
- Wait for the visible connection dialog.
- Read the heading and the available dialog controls.
- Dismiss the dialog without a send action.
- Return this development result:

```text
{
  memberId,
  stage: "dialog_inspection",
  actionSource,
  heading,
  hasAddNote,
  hasSendWithoutNote,
  dismissed
}
```

- Update the TypeScript result type before the backend test.
- Test the direct Connect and More > Connect paths.
- Stop when both paths open and dismiss the correct dialog.

### 5. Add sending without a note

- This is the first step that can send an invitation.
- Treat an absent or blank note as no note.
- Return `BAD_ARGS` for a nonblank note until Step 6.
- Open the connection dialog and click Send without a note.
- Wait for the dialog to close.
- Run state detection again.
- Return `sent` only when Pending or Withdraw invitation appears.
- Return this development result:

```text
{
  memberId,
  stage: "send_without_note",
  status,
  pendingEvidence
}
```

- Update the TypeScript result type before the backend test.
- Use one selected profile for the send test.
- Stop when the backend result contains `status: "sent"` and pending evidence.

### 6. Add sending with a note

- Reject more than 300 characters before the Connect click.
- Click Add a note.
- Set the textarea with the browser's native value setter.
- Send an `input` event.
- Confirm that the textarea contains the full note.
- Wait until the Send invitation button is enabled.
- Click Send invitation.
- Run state detection again and require pending evidence.
- Add temporary note-form evidence to the development result.
- Update the TypeScript result type before the backend test.
- Use one selected profile for the send test.

### 7. Finalize the RPC contract

- Remove `stage`, raw actions, menu items, and other development-only result fields.
- Keep detailed UI evidence in errors and extension logs.
- Make the TypeScript result match the final public interface.
- Return only `memberId` and `status` after a successful command.
- Confirm the `sent`, `already_connected`, and `already_pending` results through the backend development console.

## Selector Rules

- Search inside the visible profile top card, open menu, or connection dialog.
- Use `isVisible` for every selected control.
- Use semantic attributes and exact visible text.
- Do not use `ember` IDs or hashed CSS classes.
- Use a `firstVisible(selector, root)` helper for CSS selectors.
- Use a `findByName(root, selector, name)` helper for exact `aria-label` or normalized visible text.
- Find elements again after a click changes the DOM. Do not keep an old element reference.
- Keep the raw inspector data in errors when a known control is not found.

## Profile Selectors

| Purpose | Selector or test |
| --- | --- |
| Direct Connect | `a[href*="/preload/custom-invite/"][aria-label$=" to connect"]` |
| Direct Connect fallback | `[componentkey*="ConnectButtonstate:invitation"][aria-label$=" to connect"]` |
| More | Query `button`, then require `aria-label === "More"` or exact visible text `More` |
| Open menu | `[popover="manual"] [role="menu"]` |
| Menu items | `[role="menuitem"]` inside the visible open menu |
| Menu Connect | Exact menu-item text `Connect`, or a descendant `aria-label` that ends with `to connect` |
| Menu pending | Exact menu-item text `Withdraw invitation` |
| Menu connected | Exact menu-item text `Remove connection` |
| Direct pending | Query visible `button, a`, then require exact visible text `Pending` |
| Connection degree | Query visible `p, span`, then match `/^·?\s*1st$/` |

The supplied More menu does not contain Connect, Withdraw invitation, or Remove connection. DOM examples for these menu items are still required before their selectors are final.

## Confirmation Dialog Selectors

Use this dialog root:

```css
[data-test-modal][role="dialog"][aria-labelledby="send-invite-modal"]
```

Search only inside this visible root.

| Purpose | Selector |
| --- | --- |
| Close dialog | `button[data-test-modal-close-btn][aria-label="Dismiss"]` |
| Heading | `h2#send-invite-modal` |
| Add a note | `button[aria-label="Add a note"]` |
| Send without a note | `button[aria-label="Send without a note"]` |

## Add-Note Selectors

Find the dialog root again after the Add a note click.

| Purpose | Selector or test |
| --- | --- |
| Note field | `textarea#custom-message[name="message"]` |
| Note limit text | `label[for="custom-message"] .visually-hidden` |
| Character counter | Query `span[aria-live="polite"]`, then match `/^\d+\/\d+$/` |
| Cancel note | `button[aria-label="Cancel adding a note"]` |
| Send invitation | `button[aria-label="Send invitation"]` |

The textarea has no `maxlength` attribute. Keep the 300-character limit in the RPC validation. Use the label or counter only to confirm the current UI limit.

## State Detection Order

1. Find a visible direct Connect control. This is the strongest available state.
2. Find a visible Pending control and return `already_pending`.
3. If More is available, open it and inspect its visible menu items.
4. If the menu contains Connect, use it as the connection action.
5. If the menu contains Withdraw invitation, return `already_pending`.
6. If the menu contains Remove connection, return `already_connected`.
7. If there is no connection action, use a visible `1st` marker as an `already_connected` fallback.
8. If there is no known state or action, return `NOT_FOUND`.

The direct Connect check must occur before the `1st` check. The supplied direct-Connect HTML contains both `1st` and `2nd` elements.

## Result and Error Rules

- Return `sent` only after the dialog closes and state detection finds Pending or Withdraw invitation.
- Return `NOT_FOUND` for a missing profile, an inaccessible profile, or no available Connect action.
- Return `TIMEOUT` when an expected UI change does not occur.
- Return `INTERNAL` with LinkedIn's visible message for an invitation limit, required email, login page, checkpoint, or other LinkedIn block.
- A second command with a new RPC ID must return `already_pending` after the first command sends an invitation.


## Assumptions

- `memberId` is the durable Sales Navigator member ID, such as `ACo...`.
- The current reply cache continues to prevent repeat execution for the same RPC request ID.
- Preserve the current uncommitted experience changes in `profile/person/tools.ts` and its generated bundle.
