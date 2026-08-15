# chrome-extension

                         Chrome Browser
                              │
               ┌──────────────┴──────────────┐
               │                             │
        Current Web Page               Extension UI
               │                             │
               ▼                             ▼
       ┌───────────────┐             ┌───────────────┐
       │ Content Script│             │ Popup / Panel │
       │               │             │               │
       │ DOM Scanner   │             │ Scanner Config│
       └───────┬───────┘             └───────┬───────┘
               │                             │
               └──────────────┬──────────────┘
                              │
                       chrome.runtime
                              │
                              ▼
                  ┌────────────────────┐
                  │   Service Worker   │
                  │                    │
                  │ Scanner Manager    │
                  │ Job Manager        │
                  │ Message Handler    │
                  └─────────┬──────────┘
                            │
                            ▼
                  ┌────────────────────┐
                  │   Data Layer       │
                  │                    │
                  │ Repositories       │
                  │ SQLite Manager     │
                  └─────────┬──────────┘
                            │
                            ▼
                  ┌────────────────────┐
                  │ SQLite WASM + OPFS │
                  │                    │
                  │ pages              │
                  │ scan_jobs          │
                  │ scan_results       │
                  │ scanner_configs    │
                  └────────────────────┘
