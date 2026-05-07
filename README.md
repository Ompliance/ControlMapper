# ControlMapper Installation & Setup Guide

ControlMapper is a secure, browser-based tool for mapping Custom Controls to a Control Library using keyword and transformer-based semantic matching.

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
