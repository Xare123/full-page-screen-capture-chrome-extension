# Privacy practices — prepared answers

## Single purpose

Capture user-selected webpage content and prepare useful local image/PDF files through editing, redaction, export and compression in one workspace.

## Permission justifications

| Permission | Answer |
| --- | --- |
| activeTab | The user explicitly invokes the extension on a webpage. Temporary tab access captures that tab’s pixels and supplies its title/source URL for the local capture project. Persistent website access is not requested. |
| scripting | Inject a temporary content script into the invoked tab to select a region or scrolling pane, scroll and prepare content for capture, handle fixed/sticky bars, and restore page styles and scroll positions afterward. |
| storage | Keep capture preferences in local storage and temporary progress/cancellation state in session storage. Projects and thumbnails are stored locally in IndexedDB. Chrome Sync is not used. |
| unlimitedStorage | Store full-resolution screenshot projects and thumbnails locally in IndexedDB beyond the normal extension quota, so long captures and editable libraries can be saved. Physical device capacity still applies. |
| clipboardWrite | Write a full-resolution flattened PNG to the clipboard when the user explicitly chooses Copy image. No clipboard reading is performed by the release. |

## Remote code

No. All JavaScript, PDF workers, fonts, character maps, decoders and WebAssembly assets ship in the extension. It does not fetch or execute remote code or call a developer service. There are no release host permissions or external messaging entrypoints.

## Data use

Describe the actual local handling: user-requested screenshots and imported files, page title/source URL/date, image dimensions, thumbnails and edits. Page pixels may include personal communications or other sensitive content that the user chose to capture. No content is transmitted to the developer, sold, used for advertising, or read by developer staff. Exports and clipboard copies occur only when the user requests them.

The Chrome Web Store requires disclosure even for data handled only locally. Do not equate “no server uploads” with “the extension never handles user data.” In the current dashboard, disclose Website content and the saved page URL/title information as applicable; email capture also handles Personal communications. Review other category wording against user-selected capture/import content before making the publisher’s final certification. This file records behavior; it does not falsely claim the dashboard has been submitted.

Local projects persist until deleted, extension data is cleared, the profile is deleted, or the extension is uninstalled. Exported files and clipboard copies are separate. Editable originals remain until deletion even when an exported copy is redacted.

Homepage/privacy/support policy content is in the supplied website. The site itself adds no analytics or embedded third-party video. Optional Stripe-hosted donations use a separate live website checkout and do not affect extension features. Contributions are one-time, with a customer-chosen USD amount ($5 suggested, $1 minimum). The extension receives no payment or card data.

Source references: `manifest.json`, `src/background.js`, `src/content.js`, `src/db.js`, `src/app.js`, `src/pdf.js`, `README.md`. Current policy references: [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) and [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).
