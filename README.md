# ControlMapper

ControlMapper is a free, browser-based compliance control mapping and gap analysis tool for GRC teams. It helps practitioners compare regulations, frameworks, customer requirements, and internal control libraries, then review likely matches using keyword and semantic similarity.

## About ControlMapper

Regulatory requirements, standards, and customer assurance expectations are changing quickly. Governance, Risk and Compliance practitioners often need to assess whether existing control libraries still cover new or updated obligations. ControlMapper supports that workflow by helping users map custom controls to an existing control library, identify likely matches, and review possible gaps.

The tool does not map or approve controls on behalf of the user. It ranks candidate matches and presents the source text, candidate control text, scores, and optional gap analysis so the practitioner remains the decision-maker.

## Key features

- **Protects privacy:** No data is sent to our servers. All calculations happen locally on your device.
- **Speeds up initial mapping:** Instead of manually scanning a control library, users upload a regulatory/custom control set and a control library. ControlMapper ranks likely matches using keyword and semantic similarity.
- **Supports human review rather than replacing it:** The tool does not auto-approve mappings. It gives candidate matches, scores, and text side by side so the practitioner remains the decision-maker.
- **Highlights possible gaps:** The LLM gap analysis can compare a custom requirement against a candidate control and list requirements present in the custom control but missing from the control library.
- **Handles partial coverage:** Group Analysis helps when one requirement is covered by multiple controls, which is common in real control libraries.
- **Works with spreadsheets:** Many GRC teams still operate heavily in Excel. ControlMapper meets users where their data already is, instead of requiring immediate migration into a full GRC platform.

## How to use

1. **Upload data:** Upload your Control Library and Custom Controls data in Excel or CSV format. Select the ID and description columns used for matching.
2. **Load semantic matching when needed:** In Settings, load the semantic model to enable semantic and weighted-average scoring. If you do not load it, Mapping can still use keyword-only scores.
3. **Review candidate matches:** Use the Mapping tab to review ranked matches, compare source and candidate text side by side, and choose mappings manually.
4. **Configure gap analysis optionally:** Enable AI Gap Analysis in Settings, then use Browser Local LLM or a configured cloud/provider LLM to compare controls. Group Analysis can compare multiple mapped Control Library controls against one Custom Control.
5. **Export results:** Download the mapping results to Excel at any point in the process.

## How to access ControlMapper

There are **two ways** to use the tool:

1. **Hosted (no download)**  
   Open it in your browser at **[https://www.ompliance.com/controlmapper](https://www.ompliance.com/controlmapper)**.  
   You only need a modern browser and (for first-time model load) an internet connection. Everything below about copying files is **not** required.

2. **From GitHub (download / clone)**  
   Get the app files from this repository — either **clone** the repo or use **Code → Download ZIP** — then follow [Local setup](#local-setup-github-download).

---

## Local setup (GitHub download)

Use this section when you run ControlMapper from files on your machine (not the hosted URL).

**What you need**

- **Browser**: Chrome, Edge, or Firefox (recommended).
- **Internet**: For the first-time transformer model download (unless you use fully local model files). Browser Local LLM gap analysis also needs a first-time model/runtime download.
- **Files**: At minimum `index.html`, `app.js`, and `styles.css`. Include `models/` if you use **Local Folder** as the model source in Settings.
- **Optional**: Python, Node.js, or VS Code Live Server — only if opening `index.html` directly (`file://`) fails in your environment.

**Steps**

1. Copy or extract the repo so you have `index.html`, `app.js`, `styles.css`, and optionally `models/`.
2. Open `index.html` in your browser (double-click or **Open with** your browser).
3. If that fails (modules/CORS/security), run a small local server:

   **Python**
   ```bash
   python -m http.server 8000
   ```

   **Node.js**
   ```bash
   npx serve .
   ```

   **VS Code**: Right-click `index.html` → **Open with Live Server**.

4. Open `http://localhost:8000` (or the port your tool prints).

---

## Model Source Behavior

- Default semantic-matching model source is **GitHub Repo (Ompliance/ControlMapper)**.
- You can switch source in **Settings > Model Source**:
  - `GitHub Repo (Ompliance/ControlMapper)`
  - `Local Folder (Self-hosted)`
  - `Custom URL...`
- Semantic model files are cached in browser storage after first successful load.

## Browser Local LLM Gap Analysis

- In **Settings > Generative AI Features**, choose **Browser Local LLM (No API Key)** to run gap analysis fully in the browser.
- The default local LLM is `Llama-3.2-1B-Instruct-q4f16_1-MLC`.
- The first download for the default local LLM is about **705 MB** plus smaller runtime files. On typical broadband this may take **1-3 minutes**; slower, VPN, or corporate networks may take longer.
- The model is cached locally by the browser after it loads successfully.
- Browser Local LLM requires WebGPU support and enough available memory. Current desktop Chrome or Edge usually provides the best experience.
- If Browser Local LLM is unavailable on a device, use Gemini or OpenAI-compatible gap analysis instead.

## Troubleshooting

- **Model fails to load**:
  - Check internet connection.
  - Confirm selected model source in Settings.
  - If using **Local Folder**, run via `http://localhost` instead of `file://` and ensure `models/` path exists.
- **Browser Local LLM fails to load**:
  - Use a WebGPU-capable browser such as current desktop Chrome or Edge.
  - Confirm the device has enough available memory for the selected model.
  - Check whether a VPN, proxy, or corporate policy blocks model downloads or WebGPU.
- **CORS or module loading issues**:
  - Use one of the local server options above.
- **Excel parsing issues**:
  - Ensure files are in `.xlsx`, `.xls`, or `.csv` format.
