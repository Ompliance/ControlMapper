document.addEventListener('DOMContentLoaded', () => {

    const LEGACY_AI_PROMPT_TEMPLATE = `Compare these two security controls and identify any GAPS in Control Library relative to Custom Controls. \n\nCustom Controls: "{{customText}}"\nControl Library: "{{controlLibraryText}}"\n\nResponse should be a concise summary of missing elements in Control Library. If no significant gaps, say "No significant gaps detected."`;
    const LEGACY_AI_GROUP_PROMPT_TEMPLATE = `You are a security compliance expert. Compare multiple security controls (Control Library) against one control (Custom Controls). Identify if the COMBINED set of Control Library controls covers all elements of Custom Controls. If there are still GAPS, identify them concisely.\n\nCustom Controls: "{{customText}}"\nControl Library:\n{{controlLibraryList}}\n\nResponse should be a concise summary of missing elements in the combined set. If no significant gaps, say "No significant gaps detected."`;
    const PREVIOUS_AI_PROMPT_TEMPLATE = `Compare these two controls and identify any GAPS in Control Library relative to Custom Controls. \n\nCustom Controls: "{{customText}}"\nControl Library: "{{controlLibraryText}}"\n\nResponse should be a concise summary of missing elements in Control Library. If no significant gaps, say "No significant gaps detected."`;
    const PREVIOUS_AI_GROUP_PROMPT_TEMPLATE = `Compare multiple controls (Control Library) against one control (Custom Controls). Identify if the COMBINED set of Control Library controls covers all elements of Custom Controls. If there are still GAPS, identify them concisely.\n\nCustom Controls: "{{customText}}"\nControl Library:\n{{controlLibraryList}}\n\nResponse should be a concise summary of missing elements in the combined set. If no significant gaps, say "No significant gaps detected."`;
    const DEFAULT_AI_PROMPT_TEMPLATE = `Custom Controls: "{{customText}}"
Control Library: "{{controlLibraryText}}"

List out the requirements present in the Custom Control but not present in Control Library.`;
    const DEFAULT_AI_GROUP_PROMPT_TEMPLATE = `Compare coverage in one direction only: the combined Control Library controls must cover the Custom Controls.

Custom Controls: "{{customText}}"
Control Library:
{{controlLibraryList}}

Rules:
- Identify requirements, responsibilities, scope, subject matter, timing, ownership, evidence, and outcomes in Custom Controls that are not clearly present across the combined Control Library controls.
- Treat generic, adjacent, or broader governance language as a gap when it does not clearly include the specific Custom Controls requirement.
- Do not say "No significant gaps detected" just because the controls are related or the Control Library contains extra detail.
- Do not list strengths or extra Control Library content.

Respond only in this format:
Gaps detected:
1. <missing Custom Controls requirement in plain language>

If every material Custom Controls requirement is clearly covered, respond only:
No significant gaps detected.`;

    const WEBLLM_CDN_URL = 'https://esm.run/@mlc-ai/web-llm';
    const DEFAULT_LOCAL_LLM_MODEL = 'Qwen3-0.6B-q4f16_1-MLC';
    const LOCAL_LLM_MODELS = [
        DEFAULT_LOCAL_LLM_MODEL
    ];
    const PROVIDER_DEFAULT_MODELS = ['gemini-1.5-flash', 'gpt-4o', ...LOCAL_LLM_MODELS];

    // State management
    const state = {
        drata: {
            data: null,
            columns: [],
            selectedColumn: null, // Description column
            idColumn: null,       // Specific ID column
            filename: null
        },
        custom: {
            data: null,
            columns: [],
            idColumn: null,
            selectedColumn: null,
            filename: null
        },
        mappings: {}, // format: { customControlId: [drataControlId1, drataControlId2, ...] }
        comments: {}, // format: { customControlId: { drataControlId: commentText } }
        groupComments: {}, // format: { customControlId: groupedCommentText }
        threshold: 60,
        topX: 5,
        sortBy: 'semantic', // 'semantic' or 'keyword'
        stopwords: ['a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'from', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing'],
        activeTab: 'readme',
        columnWidths: {}, // format: { classIdentifier: widthInPx }
        aiEnabled: false,
        modelSource: 'github',
        weightSemantic: 50, // 0-100, percentage for semantic weight
        embeddings: {
            drata: new Map(), // drataText -> embedding
            custom: new Map() // customText -> embedding
        },
        drataTokens: new Map(), // drataText -> Set of tokens
        gapAnalysisEnabled: false,
        geminiApiKey: '',
        aiProvider: 'browser-local',
        aiBaseUrl: '',
        aiModel: DEFAULT_LOCAL_LLM_MODEL,
        localLlmModel: DEFAULT_LOCAL_LLM_MODEL,
        aiPromptTemplate: DEFAULT_AI_PROMPT_TEMPLATE,
        aiGroupPromptTemplate: DEFAULT_AI_GROUP_PROMPT_TEMPLATE,
        autoLoadModel: false,
        theme: 'dark'
    };

    const modelStatus = document.getElementById('model-status');
    const mappingProgress = document.createElement('div');
    mappingProgress.id = 'mapping-progress';
    mappingProgress.className = 'model-status';
    mappingProgress.style.display = 'none';
    mappingProgress.style.marginLeft = '10px';

    let semanticPipeline = null;
    let pipelinePromise = null;
    let isPipelineLoading = false;
    let webLlmModule = null;
    let localLlmEngine = null;
    let localLlmPromise = null;
    let localLlmGenerationQueue = Promise.resolve();
    let loadedLocalLlmModel = null;

    async function initSemanticPipeline() {
        if (semanticPipeline) return; // Already loaded
        if (pipelinePromise) return pipelinePromise; // Wait for existing load

        pipelinePromise = (async () => {
            const headerStatus = document.getElementById('header-ai-status');
            const headerStatusText = headerStatus ? headerStatus.querySelector('.status-text') : null;

            if (!window.transformers) {
                console.error("Transformers.js not found. Check your internet connection.");
                if (modelStatus) {
                    modelStatus.style.display = 'flex';
                    modelStatus.innerHTML = '<span style="color:#ef4444">Library missing (Transformers.js). Please refresh.</span>';
                }
                pipelinePromise = null;
                return;
            }

            const isLocalProtocol = window.location.protocol === 'file:';
            const env = window.transformers.env;

            if (state.modelSource === 'local') {
                if (isLocalProtocol) {
                    console.error("Local model loading is blocked by browser security (file://). Please use a local server.");
                    if (modelStatus) {
                        modelStatus.style.display = 'flex';
                        modelStatus.innerHTML = '<span style="color:#ef4444">Browser security blocks local files (file://). Please use a web server (e.g. Live Server).</span>';
                    }
                    pipelinePromise = null;
                    return;
                }

                env.remoteHost = window.location.origin + window.location.pathname.split('/').slice(0, -1).join('/') + '/';
                env.remotePathTemplate = 'models/{model}/';
            } else if (state.modelSource === 'github') {
                env.allowLocalModels = false;
                env.allowRemoteModels = true;
                env.remoteHost = 'https://raw.githubusercontent.com/Ompliance/ControlMapper/main/';
                env.remotePathTemplate = 'models/{model}/';
            } else {
                state.modelSource = 'github';
                env.allowLocalModels = false;
                env.allowRemoteModels = true;
                env.remoteHost = 'https://raw.githubusercontent.com/Ompliance/ControlMapper/main/';
                env.remotePathTemplate = 'models/{model}/';
            }

            isPipelineLoading = true;
            updateSemanticModelButton('Loading semantic model...', true);

            if (modelStatus) {
                modelStatus.style.display = 'flex';
                modelStatus.style.opacity = '1';
                modelStatus.innerHTML = '<span class="spinner"></span> Preparing semantic model...';
            }

            if (headerStatus) {
                headerStatus.style.display = 'flex';
                if (headerStatusText) headerStatusText.textContent = 'Starting AI...';
            }

            console.log(`Loading AI Model from ${state.modelSource === 'local' ? './models/' : env.remoteHost}...`);

            // Use a timeout to detect hangs (60 seconds)
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Connection Timed Out (60s)')), 60000);
            });

            try {
                const loadPromise = window.transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                    progress_callback: (data) => {
                        const progress = data.status === 'progress' ? Math.round(data.progress) : 0;
                        if (data.status === 'progress' && modelStatus) {
                            modelStatus.innerHTML = `<span class="spinner"></span> Downloading semantic model: ${progress}%`;
                        } else if (data.status === 'download' && modelStatus) {
                            modelStatus.innerHTML = `<span class="spinner"></span> Downloading: ${data.file}...`;
                        } else if (data.status === 'ready' && modelStatus) {
                            modelStatus.innerHTML = '<span class="spinner"></span> Initializing semantic model...';
                        }

                        if (headerStatusText) {
                            headerStatusText.textContent = progress > 0 ? `AI Loading: ${progress}%` : 'AI Loading...';
                        }
                    }
                });

                semanticPipeline = await Promise.race([loadPromise, timeoutPromise]);

                console.log("AI Semantic Model Loaded Successfully.");
                if (modelStatus) {
                    modelStatus.innerHTML = '✓ Semantic matching model loaded and ready.';
                }
                updateUploadModelStatus();

                if (headerStatus) {
                    if (headerStatusText) headerStatusText.textContent = 'AI Ready';
                    setTimeout(() => {
                        headerStatus.style.opacity = '0';
                        setTimeout(() => {
                            headerStatus.style.display = 'none';
                            headerStatus.style.opacity = '1';
                        }, 500);
                    }, 3000);
                }
            } catch (error) {
                console.error("Failed to load AI Semantic Model:", error);
                state.aiEnabled = false;
                if (aiToggle) aiToggle.checked = false;
                if (modelStatus) {
                    const isTimeout = error.message.includes('Timed Out');
                    const suggestMirror = state.modelSource.includes('huggingface.co');
                    modelStatus.innerHTML = `<div style="color:#ef4444; display: flex; flex-direction: column; gap: 0.25rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                        <span>${isTimeout ? 'Request Timed Out.' : 'Connection Failed.'}</span>
                        <a href="#" onclick="retryAiLoad(); return false;" style="color: var(--primary); text-decoration: underline;">Retry?</a>
                    </div>
                    ${suggestMirror ? '<small style="color: var(--text-muted); opacity: 0.8;">Company network blocking HF? Try <strong>HF Mirror</strong> in Settings.</small>' : ''}
                </div>`;
                }

                if (headerStatus) headerStatus.style.display = 'none';

                pipelinePromise = null; // Clear so it can be retried
            } finally {
                isPipelineLoading = false;
                if (semanticPipeline) {
                    updateSemanticModelButton('Semantic model ready', true);
                } else {
                    updateSemanticModelButton('Retry semantic model load');
                }
                updateUploadModelStatus();
            }
        })();

        return pipelinePromise;
    }

    async function getEmbedding(text, type) {
        if (!text || !state.aiEnabled) return null;
        if (!semanticPipeline) return null;

        const cache = state.embeddings[type];
        if (cache.has(text)) return cache.get(text);

        try {
            const output = await semanticPipeline(text, { pooling: 'mean', normalize: true });
            const embedding = Array.from(output.data);
            cache.set(text, embedding);
            // console.log(`Generated embedding for: "${text.substring(0, 30)}..." (Length: ${embedding.length})`);
            return embedding;
        } catch (error) {
            console.error("Embedding error for:", text, error);
            return null;
        }
    }

    function cosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB) return 0;
        let dotProduct = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
        }
        return Math.max(0, Math.min(1, dotProduct));
    }

    async function precalculateEmbeddings(texts, type) {
        if (!state.aiEnabled || !semanticPipeline) return;

        const uniqueTexts = [...new Set(texts)].filter(t => t && !state.embeddings[type].has(t));
        if (uniqueTexts.length === 0) {
            console.log(`All ${type} embeddings already cached.`);
            return;
        }

        console.log(`Pre-calculating ${uniqueTexts.length} embeddings for ${type}...`);

        // Process in small batches to avoid blocking the UI too long even during pre-calc
        const batchSize = 10;
        for (let i = 0; i < uniqueTexts.length; i += batchSize) {
            const batch = uniqueTexts.slice(i, i + batchSize);
            await Promise.all(batch.map(text => getEmbedding(text, type)));

            if (modelStatus) {
                const progress = Math.round(((i + batch.length) / uniqueTexts.length) * 100);
                modelStatus.innerHTML = `<span class="spinner"></span> AI Analysis: ${progress}%`;
                modelStatus.style.display = 'flex';
                modelStatus.style.opacity = '1';
            }
        }

        if (modelStatus) {
            modelStatus.innerHTML = '✨ AI Analysis: complete';
            modelStatus.style.display = 'flex';
            modelStatus.style.opacity = '1';
        }
    }

    function calculateScoresSync(customText, drataText) {
        // Keyword Score (Jaccard variant)
        const customTokens = new Set(tokenize(customText));

        if (!state.drataTokens.has(drataText)) {
            state.drataTokens.set(drataText, new Set(tokenize(drataText)));
        }
        const drataTokensSet = state.drataTokens.get(drataText);

        let matchCount = 0;
        customTokens.forEach(token => {
            if (drataTokensSet.has(token)) matchCount++;
        });

        const keywordScore = customTokens.size > 0
            ? (matchCount / Math.max(customTokens.size, drataTokensSet.size)) * 100
            : 0;

        // Semantic Score (using cached embeddings)
        let semanticScore = 0;
        const semanticAvailable = state.aiEnabled && !!semanticPipeline;
        if (semanticAvailable) {
            const vecA = state.embeddings.custom.get(customText);
            const vecB = state.embeddings.drata.get(drataText);
            if (vecA && vecB) {
                semanticScore = cosineSimilarity(vecA, vecB) * 100;
            }
        }

        // Weighted Score
        const semanticWeight = semanticAvailable ? state.weightSemantic / 100 : 0;
        const keywordWeight = 1 - semanticWeight;
        const weightedScore = (keywordScore * keywordWeight) + (semanticScore * semanticWeight);

        return { keyword: keywordScore, semantic: semanticScore, weighted: weightedScore };
    }

    // DOM Elements
    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    const drataInput = document.getElementById('drata-file');
    const customInput = document.getElementById('custom-file');

    const drataStatus = document.getElementById('drata-status');
    const customStatus = document.getElementById('custom-status');

    const drataFilename = document.getElementById('drata-filename');
    const drataRowCount = document.getElementById('drata-row-count');
    const customFilename = document.getElementById('custom-filename');
    const customRowCount = document.getElementById('custom-row-count');

    const drataColContainer = document.getElementById('drata-column-container');
    const customColContainer = document.getElementById('custom-column-container');

    const drataSelect = document.getElementById('drata-column');
    const drataIdSelect = document.getElementById('drata-id-column');
    const customSelect = document.getElementById('custom-column');
    const customIdSelect = document.getElementById('custom-id-column');

    // DOM Elements - Mapping UI
    const topXInput = document.getElementById('top-x-input');
    const sortBySelect = document.getElementById('sort-by-select');

    // DOM Elements - Mapping Table
    const mappingBody = document.getElementById('mapping-body');

    const summarySection = document.getElementById('comparison-summary');
    const refreshMappingBtn = document.getElementById('refresh-mapping-btn');
    const drataPreview = document.getElementById('drata-col-preview');
    const customPreview = document.getElementById('custom-col-preview');

    const exportBtn = document.getElementById('download-results-btn');
    const themeToggle = document.getElementById('theme-toggle');
    const aiToggle = document.getElementById('ai-toggle');
    const downloadAiBtn = document.getElementById('download-ai-btn');
    const modelSourceSelect = document.getElementById('model-source-select');
    const uploadModelStatus = document.getElementById('upload-model-status');

    const mappingWeightSlider = document.getElementById('mapping-weight-slider');
    const weightDisplay = document.getElementById('weight-value-display');

    // Sheet Modal Elements
    const sheetModal = document.getElementById('sheet-modal');
    const sheetList = document.getElementById('sheet-list');
    const closeSheetModal = document.getElementById('close-sheet-modal');
    const confirmLoadBtn = document.getElementById('confirm-load-btn');
    const cancelLoadBtn = document.getElementById('cancel-load-btn');
    const headerRowInput = document.getElementById('header-row-input');
    const gapAnalysisToggle = document.getElementById('gap-analysis-toggle');
    const geminiApiKeyInput = document.getElementById('gemini-api-key');
    const aiProviderSelect = document.getElementById('ai-provider-select');
    const aiBaseUrlInput = document.getElementById('ai-base-url');
    const aiModelNameInput = document.getElementById('ai-model-name');
    const apiKeyContainer = document.getElementById('api-key-container');
    const aiBaseUrlContainer = document.getElementById('ai-base-url-container');
    const aiModelContainer = document.getElementById('ai-model-container');
    const localLlmContainer = document.getElementById('local-llm-container');
    const externalAiWarning = document.getElementById('external-ai-warning');
    const localLlmModelSelect = document.getElementById('local-llm-model-select');
    const localLlmLoadBtn = document.getElementById('local-llm-load-btn');
    const localLlmStatus = document.getElementById('local-llm-status');
    const aiPromptTemplateInput = document.getElementById('ai-prompt-template');
    const aiGroupPromptTemplateInput = document.getElementById('ai-group-prompt-template');
    const autoLoadToggle = document.getElementById('auto-load-toggle');

    function applyTheme(theme) {
        const normalizedTheme = theme === 'light' ? 'light' : 'dark';
        state.theme = normalizedTheme;
        document.body.dataset.theme = normalizedTheme;

        if (themeToggle) {
            const isLight = normalizedTheme === 'light';
            themeToggle.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
            themeToggle.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
            const icon = themeToggle.querySelector('.theme-toggle-icon');
            if (icon) icon.textContent = isLight ? '☀' : '☾';
        }
    }

    function updateSemanticModelButton(label = 'Load semantic model now', disabled = false) {
        if (!downloadAiBtn) return;
        downloadAiBtn.textContent = label;
        downloadAiBtn.disabled = disabled;
    }

    function showSemanticModelIdleStatus() {
        if (semanticPipeline) {
            if (modelStatus) {
                modelStatus.style.display = 'flex';
                modelStatus.style.opacity = '1';
                modelStatus.innerHTML = '✓ Semantic matching model loaded and ready.';
            }
            updateSemanticModelButton('Semantic model ready', true);
            return;
        }

        if (pipelinePromise || isPipelineLoading) {
            updateSemanticModelButton('Loading semantic model...', true);
            return;
        }

        if (modelStatus) {
            modelStatus.style.display = 'flex';
            modelStatus.style.opacity = '1';
            modelStatus.innerHTML = 'Semantic model not loaded. Mapping will use keyword-only scores until you load it.';
        }
        updateSemanticModelButton('Load semantic model now');
    }

    function updateUploadModelStatus() {
        if (!uploadModelStatus) return;

        const semanticReady = !!semanticPipeline;
        const localLlmReady = !!localLlmEngine && loadedLocalLlmModel === (state.localLlmModel || DEFAULT_LOCAL_LLM_MODEL);
        const cloudLlmConfigured = state.aiProvider !== 'browser-local' && (!!state.geminiApiKey || (state.aiProvider === 'openai' && isLocalOpenAiEndpoint(state.aiBaseUrl)));
        const llmReady = localLlmReady || cloudLlmConfigured;

        if (semanticReady && llmReady) {
            uploadModelStatus.className = 'model-readiness-banner ready';
            uploadModelStatus.textContent = '✓ Models ready: semantic matching is loaded and gap analysis is configured.';
            return;
        }

        const missing = [];
        if (!semanticReady) missing.push('semantic matching model');
        if (!llmReady) missing.push('load Browser Local LLM or provide an API key');

        uploadModelStatus.className = 'model-readiness-banner warning';
        uploadModelStatus.textContent = `⚠ Models not fully ready. Please go to Settings and ${missing.join(' and ')}.`;
    }

    // Toggle Retry logic
    window.retryAiLoad = () => {
        state.aiEnabled = true;
        if (aiToggle) aiToggle.checked = true;
        initSemanticPipeline();
    };

    function updateLocalLlmStatus(message, isError = false) {
        if (!localLlmStatus) return;
        localLlmStatus.style.display = message ? 'flex' : 'none';
        localLlmStatus.textContent = message || '';
        localLlmStatus.style.color = isError ? '#ef4444' : 'var(--text-muted)';
    }

    function updateLocalLlmLoadButton(label = 'Load model now', disabled = false) {
        if (!localLlmLoadBtn) return;
        localLlmLoadBtn.textContent = label;
        localLlmLoadBtn.disabled = disabled;
    }

    function showLocalLlmIdleStatus() {
        if (state.aiProvider !== 'browser-local') return;
        const modelId = state.localLlmModel || DEFAULT_LOCAL_LLM_MODEL;

        if (localLlmEngine && loadedLocalLlmModel === modelId) {
            updateLocalLlmStatus(`Browser Local LLM ready: ${modelId}`);
            updateLocalLlmLoadButton('Model ready', true);
            return;
        }

        if (localLlmPromise && loadedLocalLlmModel === modelId) {
            updateLocalLlmLoadButton('Loading model...', true);
            return;
        }

        updateLocalLlmStatus('Not loaded yet. Download/load starts when you run analysis or click Load model now. Progress appears here.');
        updateLocalLlmLoadButton('Load model now');
    }

    function formatAiErrorMessage(error) {
        const rawMessage = error?.message || String(error || '');
        const lowerMessage = rawMessage.toLowerCase();

        if (lowerMessage.includes('dxgi_error_device_removed') || lowerMessage.includes('d3d12 create command queue failed') || lowerMessage.includes('requestdevice')) {
            return '⚠️ Analysis failed. Browser WebGPU cannot create a usable GPU device in this browser session. Restart the browser, check chrome://gpu or edge://gpu for WebGPU support, or use Gemini/OpenAI-compatible analysis instead of Browser Local LLM on this machine.';
        }

        if (lowerMessage.includes('mapasync') || lowerMessage.includes('buffer was unmapped')) {
            return '⚠️ Analysis failed. Browser WebGPU failed during generation. The app reset the local model and retried once; if it repeats, reload the page and try Qwen again.';
        }

        const detail = rawMessage && rawMessage !== '[object Object]' ? ` Detail: ${rawMessage}` : '';
        return `⚠️ Analysis failed.${detail}`;
    }

    function isTransientWebGpuError(error) {
        const message = (error?.message || String(error || '')).toLowerCase();
        return message.includes('gpu')
            || message.includes('mapasync')
            || message.includes('requestdevice')
            || message.includes('dxgi_error_device_removed')
            || message.includes('d3d12 create command queue failed')
            || message.includes('buffer was unmapped');
    }

    function resetBrowserLocalLlm() {
        localLlmEngine = null;
        localLlmPromise = null;
        loadedLocalLlmModel = null;
        updateLocalLlmLoadButton('Retry load');
        updateUploadModelStatus();
    }

    function stripModelThinking(text) {
        let cleaned = String(text || '').trim();
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
        return cleaned;
    }

    function normalizeTemplateForMigration(template) {
        return String(template || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function isOldSingleGapTemplate(template) {
        const normalized = normalizeTemplateForMigration(template);
        const isKnownOldDefault = normalized.includes('compare these two')
            || normalized.includes('compare coverage in one direction only');

        return isKnownOldDefault
            && normalized.includes('custom controls')
            && normalized.includes('control library')
            && normalized.includes('no significant gaps detected');
    }

    function isOldGroupGapTemplate(template) {
        const normalized = normalizeTemplateForMigration(template);
        return normalized.includes('compare multiple')
            && normalized.includes('custom controls')
            && normalized.includes('control library')
            && normalized.includes('combined')
            && normalized.includes('no significant gaps detected')
            && !normalized.includes('compare coverage in one direction only');
    }

    function getDefaultAiModelForProvider(provider) {
        if (provider === 'gemini') return 'gemini-1.5-flash';
        if (provider === 'openai') return 'gpt-4o';
        return state.localLlmModel || DEFAULT_LOCAL_LLM_MODEL;
    }

    function syncAiProviderSettings() {
        const isLocalBrowser = state.aiProvider === 'browser-local';
        const isOpenAiCompatible = state.aiProvider === 'openai';

        if (apiKeyContainer) apiKeyContainer.style.display = isLocalBrowser ? 'none' : 'flex';
        if (aiBaseUrlContainer) aiBaseUrlContainer.style.display = isOpenAiCompatible ? 'flex' : 'none';
        if (aiModelContainer) aiModelContainer.style.display = isLocalBrowser ? 'none' : 'flex';
        if (localLlmContainer) localLlmContainer.style.display = isLocalBrowser ? 'flex' : 'none';
        if (externalAiWarning) externalAiWarning.style.display = isLocalBrowser ? 'none' : 'block';
        if (localLlmStatus && !isLocalBrowser) updateLocalLlmStatus('');
        if (!isLocalBrowser) updateLocalLlmLoadButton('Load model now');

        if (aiProviderSelect) aiProviderSelect.value = state.aiProvider || 'browser-local';
        if (localLlmModelSelect) localLlmModelSelect.value = state.localLlmModel || DEFAULT_LOCAL_LLM_MODEL;
        if (aiModelNameInput) aiModelNameInput.value = state.aiModel || getDefaultAiModelForProvider(state.aiProvider);
        if (isLocalBrowser) showLocalLlmIdleStatus();
    }

    function isLocalOpenAiEndpoint(baseUrl) {
        if (!baseUrl) return false;
        try {
            const url = new URL(baseUrl);
            return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
        } catch (e) {
            return /^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(baseUrl);
        }
    }

    function validateGapAnalysisSettings() {
        if (!state.gapAnalysisEnabled) {
            return 'Please enable AI Gap Analysis in Settings first.';
        }

        if (state.aiProvider === 'browser-local') return '';

        if (state.aiProvider === 'openai' && !state.geminiApiKey && isLocalOpenAiEndpoint(state.aiBaseUrl)) {
            return '';
        }

        if (!state.geminiApiKey) {
            return 'Please provide an API key or choose Browser Local LLM in Settings first.';
        }

        return '';
    }

    async function initBrowserLocalLlm() {
        const modelId = state.localLlmModel || DEFAULT_LOCAL_LLM_MODEL;

        if (localLlmEngine && loadedLocalLlmModel === modelId) {
            return localLlmEngine;
        }

        if (localLlmPromise && loadedLocalLlmModel === modelId) {
            return localLlmPromise;
        }

        if (!navigator.gpu) {
            throw new Error('Browser Local LLM requires WebGPU. Try a current Chrome or Edge browser with WebGPU enabled.');
        }

        localLlmPromise = (async () => {
            updateLocalLlmStatus('Preparing Browser Local LLM. First download may take 1-5 minutes and is cached locally...');
            updateLocalLlmLoadButton('Loading model...', true);

            if (!webLlmModule) {
                webLlmModule = await import(WEBLLM_CDN_URL);
            }

            const initProgressCallback = (progress) => {
                const percent = typeof progress.progress === 'number' ? ` ${Math.round(progress.progress * 100)}%` : '';
                const text = progress.text || 'Downloading/loading local model';
                updateLocalLlmStatus(`${text}${percent}`);
            };

            loadedLocalLlmModel = modelId;
            localLlmEngine = await webLlmModule.CreateMLCEngine(modelId, { initProgressCallback });
            updateLocalLlmStatus(`Browser Local LLM ready: ${modelId}`);
            updateLocalLlmLoadButton('Model ready', true);
            updateUploadModelStatus();
            return localLlmEngine;
        })();

        try {
            return await localLlmPromise;
        } catch (error) {
            localLlmPromise = null;
            loadedLocalLlmModel = null;
            updateLocalLlmStatus(error.message || 'Browser Local LLM failed to load.', true);
            updateLocalLlmLoadButton('Retry load');
            updateUploadModelStatus();
            throw error;
        }
    }

    async function generateWithBrowserLocalLlm(prompt) {
        const runGeneration = async (attempt = 1) => {
            const engine = await initBrowserLocalLlm();
            updateLocalLlmStatus(attempt === 1 ? 'Generating local gap analysis...' : 'Retrying local generation after WebGPU reset...');

            const completion = await engine.chat.completions.create({
                messages: [
                    { role: 'system', content: 'You are a strict control mapping reviewer. Compare only from Custom Controls to Control Library. Report a gap when the Control Library omits, generalizes, or only indirectly addresses a Custom Controls requirement. Do not reward extra detail in the Control Library unless it covers the Custom Controls requirement. Return only the final answer. Do not include reasoning, chain-of-thought, thinking tags, or analysis notes.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0,
                max_tokens: 1024
            });

            const result = stripModelThinking(completion?.choices?.[0]?.message?.content);
            if (!result) throw new Error('Invalid Browser Local LLM response');
            updateLocalLlmStatus(`Browser Local LLM ready: ${state.localLlmModel || DEFAULT_LOCAL_LLM_MODEL}`);
            return result;
        };

        const queuedGeneration = localLlmGenerationQueue
            .catch(() => { })
            .then(async () => {
                try {
                    return await runGeneration();
                } catch (error) {
                    if (!isTransientWebGpuError(error)) throw error;
                    console.warn('Browser Local LLM WebGPU generation failed; resetting engine and retrying once.', error);
                    resetBrowserLocalLlm();
                    return runGeneration(2);
                }
            });

        localLlmGenerationQueue = queuedGeneration.catch(() => { });
        return queuedGeneration;
    }

    async function generateGapAnalysisText(prompt) {
        if (state.aiProvider === 'browser-local') {
            return generateWithBrowserLocalLlm(prompt);
        }

        if (state.aiProvider === 'gemini') {
            const model = state.aiModel || 'gemini-1.5-flash';
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.geminiApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0
                    }
                })
            });

            const data = await response.json();
            if (data.candidates && data.candidates[0].content.parts[0].text) {
                return stripModelThinking(data.candidates[0].content.parts[0].text);
            }
            throw new Error('Invalid Gemini response');
        }

        if (state.aiProvider === 'openai') {
            const baseUrl = state.aiBaseUrl || 'https://api.openai.com/v1';
            const model = state.aiModel || 'gpt-4o';
            const headers = { 'Content-Type': 'application/json' };
            if (state.geminiApiKey) {
                headers.Authorization = `Bearer ${state.geminiApiKey}`;
            }

            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: 'You are a strict control mapping reviewer. Compare only from Custom Controls to Control Library. Report a gap when the Control Library omits, generalizes, or only indirectly addresses a Custom Controls requirement. Do not reward extra detail in the Control Library unless it covers the Custom Controls requirement. Return only the final answer. Do not include reasoning, chain-of-thought, thinking tags, or analysis notes.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0
                })
            });

            const data = await response.json();
            if (data.choices && data.choices[0].message.content) {
                return stripModelThinking(data.choices[0].message.content);
            }
            throw new Error('Invalid OpenAI-compatible response');
        }

        throw new Error(`Unsupported AI provider: ${state.aiProvider}`);
    }

    // NLP Utils
    function tokenize(text) {
        if (!text) return [];
        const stopSet = new Set(state.stopwords);
        return String(text).toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 1 && !stopSet.has(word));
    }

    async function calculateScores(text1, text2, type1 = 'custom', type2 = 'drata') {
        const results = { keyword: 0, semantic: 0 };
        if (!text1 || !text2) return results;

        // Keyword Match (Overlap Coefficient)
        const tokens1 = Array.from(new Set(tokenize(text1)));
        const tokens2 = Array.from(new Set(tokenize(text2)));

        if (tokens1.length > 0 && tokens2.length > 0) {
            const set2 = new Set(tokens2);
            const intersection = tokens1.filter(x => set2.has(x));
            results.keyword = (intersection.length / Math.min(tokens1.length, tokens2.length)) * 100;
        }

        // Semantic Match (AI Embeddings)
        if (state.aiEnabled) {
            const emb1 = await getEmbedding(text1, type1);
            const emb2 = await getEmbedding(text2, type2);

            if (emb1 && emb2) {
                results.semantic = cosineSimilarity(emb1, emb2) * 100;
            }
        }

        return results;
    }

    function getColumnValue(obj, columnName) {
        if (!obj || !columnName) return null;

        // 1. Direct match (most efficient)
        if (obj[columnName] !== undefined && obj[columnName] !== null) return obj[columnName];

        // 2. Case-insensitive and trimmed match
        const lowerName = String(columnName).toLowerCase().trim();
        const keys = Object.keys(obj);
        for (const k of keys) {
            if (String(k).toLowerCase().trim() === lowerName) {
                return obj[k];
            }
        }

        // 3. Partial match as a last resort (e.g. "ID (Required)" matches "ID")
        for (const k of keys) {
            const lowerK = String(k).toLowerCase().trim();
            if (lowerK.includes(lowerName) || lowerName.includes(lowerK)) {
                return obj[k];
            }
        }

        return null;
    }

    function findBestId(obj) {
        if (!obj) return null;
        const idTerms = ['id', 'reference', 'ref', 'code', 'number', 'ctrl', 'control id'];
        const keys = Object.keys(obj);
        for (const term of idTerms) {
            const match = keys.find(k => k.toLowerCase().includes(term));
            if (match && obj[match] !== undefined && obj[match] !== null) return obj[match];
        }
        return null;
    }

    // Initialize from LocalStorage
    try {
        loadState();
    } catch (error) {
        console.error("Initialization Failed:", error);
    }

    // Tab Logic
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchTab(tabName);
            if (tabName === 'mapping') renderMappingTable();
            if (tabName === 'settings') renderSettings();
            if (tabName === 'upload') updateUploadModelStatus();
        });
    });

    function switchTab(tabName) {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        tabContents.forEach(c => c.classList.toggle('active', c.id === tabName));
        state.activeTab = tabName;
        saveState();
    }

    // Settings Logic

    function renderSettings() {
        if (aiToggle) aiToggle.checked = state.aiEnabled;
        if (modelSourceSelect) modelSourceSelect.value = state.modelSource;
        if (topXInput) topXInput.value = state.topX || 5;
        if (sortBySelect) sortBySelect.value = state.sortBy || 'semantic';
        syncAiProviderSettings();
        showSemanticModelIdleStatus();
    }

    if (modelSourceSelect) {
        modelSourceSelect.addEventListener('change', (e) => {
            state.modelSource = e.target.value;
            semanticPipeline = null;
            pipelinePromise = null;
            isPipelineLoading = false;
            renderSettings();
            saveState();
        });
    }

    if (aiToggle) {
        aiToggle.addEventListener('change', (e) => {
            state.aiEnabled = e.target.checked;
            saveState();
            showSemanticModelIdleStatus();
        });
    }

    if (gapAnalysisToggle) {
        gapAnalysisToggle.addEventListener('change', (e) => {
            state.gapAnalysisEnabled = e.target.checked;
            saveState();
        });
    }

    if (geminiApiKeyInput) {
        geminiApiKeyInput.addEventListener('input', (e) => {
            state.geminiApiKey = e.target.value;
            saveState();
        });
    }

    if (aiProviderSelect) {
        aiProviderSelect.addEventListener('change', (e) => {
            state.aiProvider = e.target.value;
            if (!state.aiModel || PROVIDER_DEFAULT_MODELS.includes(state.aiModel)) {
                state.aiModel = getDefaultAiModelForProvider(state.aiProvider);
            }
            syncAiProviderSettings();
            saveState();
        });
    }

    if (localLlmModelSelect) {
        localLlmModelSelect.addEventListener('change', (e) => {
            state.localLlmModel = e.target.value;
            if (state.aiProvider === 'browser-local') {
                state.aiModel = state.localLlmModel;
                localLlmEngine = null;
                localLlmPromise = null;
                loadedLocalLlmModel = null;
                showLocalLlmIdleStatus();
            }
            saveState();
        });
    }

    if (localLlmLoadBtn) {
        localLlmLoadBtn.addEventListener('click', async () => {
            try {
                await initBrowserLocalLlm();
            } catch (error) {
                console.error('Browser Local LLM load failed:', error);
            }
        });
    }

    if (aiBaseUrlInput) {
        aiBaseUrlInput.addEventListener('input', (e) => {
            state.aiBaseUrl = e.target.value;
            saveState();
        });
    }

    if (aiModelNameInput) {
        aiModelNameInput.addEventListener('input', (e) => {
            state.aiModel = e.target.value;
            saveState();
        });
    }

    if (aiPromptTemplateInput) {
        aiPromptTemplateInput.addEventListener('input', (e) => {
            state.aiPromptTemplate = e.target.value;
            saveState();
        });
    }

    if (aiGroupPromptTemplateInput) {
        aiGroupPromptTemplateInput.addEventListener('input', (e) => {
            state.aiGroupPromptTemplate = e.target.value;
            saveState();
        });
    }

    if (autoLoadToggle) {
        autoLoadToggle.addEventListener('change', (e) => {
            state.autoLoadModel = false;
            autoLoadToggle.checked = false;
            saveState();
        });
    }

    if (downloadAiBtn) {
        downloadAiBtn.addEventListener('click', () => {
            console.log("Manual AI Initialization Triggered...");
            state.aiEnabled = true;
            if (aiToggle) aiToggle.checked = true;
            semanticPipeline = null;
            isPipelineLoading = false;
            saveState();
            initSemanticPipeline();
        });
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            applyTheme(state.theme === 'light' ? 'dark' : 'light');
            saveState();
        });
    }

    // Mapping Table Logic
    if (topXInput) {
        topXInput.addEventListener('change', (e) => {
            state.topX = parseInt(e.target.value) || 5;
            saveState();
        });
    }

    if (sortBySelect) {
        sortBySelect.addEventListener('change', (e) => {
            state.sortBy = e.target.value;
            saveState();
        });
    }

    if (mappingWeightSlider) {
        mappingWeightSlider.addEventListener('input', (e) => {
            state.weightSemantic = parseInt(e.target.value);
            if (weightDisplay) weightDisplay.textContent = state.weightSemantic;
            // No saveState here to avoid too many writes, only on change or explicit save
        });

        mappingWeightSlider.addEventListener('change', () => {
            saveState();
            renderMappingTable(); // Re-render to show updated weighted scores
        });
    }

    if (refreshMappingBtn) {
        refreshMappingBtn.addEventListener('click', () => {
            // Show loading state first
            if (mappingBody) mappingBody.innerHTML = '<tr><td colspan="7" class="empty-state">Recalculating suggestions...</td></tr>';

            // Use timeout to allow UI to render loading state
            setTimeout(() => {
                renderMappingTable();
            }, 50);
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (!state.custom.data || !state.drata.data) {
                alert('No data to export!');
                return;
            }
            exportToExcel();
        });
    }

    async function exportToExcel() {
        console.log("exportToExcel function called");
        if (!state.custom.data || !state.drata.data) {
            console.warn("Export failed: Custom Controls or Control Library data is missing", { customData: !!state.custom.data, drataData: !!state.drata.data });
            return;
        }

        console.log("Starting semantic export with data...", {
            customCount: state.custom.data.length,
            drataCount: state.drata.data.length
        });

        // Show loading state or block UI
        exportBtn.innerHTML = '⏳ Processing...';
        exportBtn.disabled = true;

        try {
            // 1. Ensure all embeddings are cached
            if (state.aiEnabled && semanticPipeline) {
                console.log("Ensuring AI embeddings are cached...");

                const customTexts = state.custom.data.map(c => getColumnValue(c, state.custom.selectedColumn) || '');
                await precalculateEmbeddings(customTexts, 'custom');

                const drataTexts = state.drata.data.map(d => getColumnValue(d, state.drata.selectedColumn) || '');
                await precalculateEmbeddings(drataTexts, 'drata');
            }

            const exportData = [];

            // Processing in batches to keep UI responsive even during export
            const total = state.custom.data.length;
            const batchSize = 20;

            for (let i = 0; i < total; i += batchSize) {
                const end = Math.min(i + batchSize, total);
                for (let cIdx = i; cIdx < end; cIdx++) {
                    const customControl = state.custom.data[cIdx];
                    const customText = getColumnValue(customControl, state.custom.selectedColumn) || '';
                    const customIdRaw = getColumnValue(customControl, state.custom.idColumn);
                    const customId = (customIdRaw !== undefined && customIdRaw !== null && customIdRaw !== '') ? String(customIdRaw) : `C-${cIdx + 1}`;
                    const mapKey = (customIdRaw !== undefined && customIdRaw !== null && customIdRaw !== '') ? String(customIdRaw) : customText;

                    // Find current mappings
                    const mappedDrataIds = state.mappings[mapKey] || [];
                    const groupComment = state.groupComments[mapKey] || '';

                    let matches = state.drata.data.map((drataControl) => {
                        const drataText = getColumnValue(drataControl, state.drata.selectedColumn) || '';
                        const scores = calculateScoresSync(customText, drataText);
                        return { control: drataControl, ...scores };
                    })
                        .sort((a, b) => b[state.sortBy] - a[state.sortBy])
                        .slice(0, state.topX);

                    // Ensure ALL mapped controls are in the exported list even if not in topX
                    mappedDrataIds.forEach(mId => {
                        const isAlreadyInMatches = matches.some(match => {
                            let rawId = getColumnValue(match.control, state.drata.idColumn) || findBestId(match.control);
                            const currentDrataId = rawId ? String(rawId) : (getColumnValue(match.control, state.drata.selectedColumn) || '');
                            return currentDrataId === mId;
                        });

                        if (!isAlreadyInMatches) {
                            const mappedControl = state.drata.data.find(d => {
                                let rawId = getColumnValue(d, state.drata.idColumn) || findBestId(d);
                                const currentDrataId = rawId ? String(rawId) : (getColumnValue(d, state.drata.selectedColumn) || '');
                                return currentDrataId === mId;
                            });

                            if (mappedControl) {
                                const drataText = getColumnValue(mappedControl, state.drata.selectedColumn) || '';
                                const scores = calculateScoresSync(customText, drataText);
                                matches.push({ control: mappedControl, ...scores, forceInclude: true });
                            }
                        }
                    });

                    if (matches.length === 0) {
                        const exportText = (customIdRaw !== null && customIdRaw !== undefined && String(customIdRaw).trim() !== '') ? (customId !== customText ? `${customId}: ${customText}` : customId) : `${cIdx + 1}: ${customText}`;

                        exportData.push({
                            '#': cIdx + 1,
                            'Regulation / Custom Controls': exportText,
                            'Keyword %': '',
                            'Semantics %': '',
                            'Weighted Avg %': '',
                            'ID': '',
                            'Control Library Text': '',
                            'Trigger LLM Analysis': '',
                            'LLM Gap Analysis': '',
                            'Mapped?': '',
                            'Grouped Analysis': groupComment
                        });
                    } else {
                        matches.forEach((match, mIdx) => {
                            const drataValue = getColumnValue(match.control, state.drata.selectedColumn) || '';
                            let rawId = getColumnValue(match.control, state.drata.idColumn) || findBestId(match.control);
                            const drataIdDisplay = rawId ? String(rawId) : 'N/A';
                            const currentDrataId = rawId ? String(rawId) : drataValue;

                            const isMapped = mappedDrataIds.includes(currentDrataId);
                            const commentKey = `${mapKey}-${currentDrataId}`;
                            const savedComment = state.comments[commentKey] || '';

                            const exportText = (customIdRaw !== null && customIdRaw !== undefined && String(customIdRaw).trim() !== '') ? (customId !== customText ? `${customId}: ${customText}` : customId) : `${cIdx + 1}: ${customText}`;

                            exportData.push({
                                '#': mIdx === 0 ? cIdx + 1 : (match.forceInclude ? '*' : ''),
                                'Regulation / Custom Controls': mIdx === 0 ? exportText : '',
                                'Keyword %': Math.round(match.keyword) + '%',
                                'Semantics %': Math.round(match.semantic) + '%',
                                'Weighted Avg %': Math.round(match.weighted) + '%',
                                'ID': drataIdDisplay,
                                'Control Library Text': drataValue,
                                'Trigger LLM Analysis': '', // Removed mapped indicator from here
                                'LLM Gap Analysis': savedComment,
                                'Mapped?': isMapped ? 'Y' : '',
                                'Grouped Analysis': mIdx === 0 ? groupComment : ''
                            });
                        });
                    }
                }
                // Yield to browser
                if (modelStatus) {
                    modelStatus.innerHTML = `<span class="spinner"></span> Exporting: ${Math.round((end / total) * 100)}%`;
                    modelStatus.style.display = 'flex';
                    modelStatus.style.opacity = '1';
                }
                await new Promise(r => setTimeout(r, 0));
            }

            const worksheet = XLSX.utils.json_to_sheet(exportData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Mapping Results');

            XLSX.writeFile(workbook, `ControlMapper_Export_${new Date().toISOString().split('T')[0]}.xlsx`);

            exportBtn.innerHTML = '📊 Export results to Excel';
            exportBtn.disabled = false;

            if (modelStatus) {
                modelStatus.innerHTML = '✨ Export Complete';
                setTimeout(() => {
                    modelStatus.style.opacity = '0';
                    setTimeout(() => modelStatus.style.display = 'none', 500);
                }, 2000);
            }
        } catch (error) {
            console.error("Export error:", error);
            alert("Export failed: " + error.message);
        } finally {
            exportBtn.innerHTML = '📊 Export results to Excel';
            exportBtn.disabled = false;
        }
    }

    async function renderMappingTable() {
        if (!state.custom.data || !state.drata.data) {
            mappingBody.innerHTML = '<tr><td colspan="8" class="empty-state">No data loaded. Use Upload tab first.</td></tr>';
            return;
        }

        const container = document.querySelector('.mapping-actions');
        if (container && !document.getElementById('mapping-progress')) {
            container.appendChild(mappingProgress);
        }

        // 1. Pre-calculate Custom Embeddings
        if (state.aiEnabled && semanticPipeline) {
            const customTexts = state.custom.data.map(c => getColumnValue(c, state.custom.selectedColumn) || '');
            await precalculateEmbeddings(customTexts, 'custom');

            const drataTexts = state.drata.data.map(d => getColumnValue(d, state.drata.selectedColumn) || '');
            await precalculateEmbeddings(drataTexts, 'drata');

        } else if (state.aiEnabled && !semanticPipeline && modelStatus) {
            modelStatus.style.display = 'flex';
            modelStatus.style.opacity = '1';
            modelStatus.innerHTML = 'Semantic model not loaded. Mapping is using keyword-only scores. Go to Settings and click Load semantic model now to enable Semantic %.';
        }

        mappingBody.innerHTML = '';
        const fragment = document.createDocumentFragment();

        mappingProgress.style.display = 'flex';
        mappingProgress.style.opacity = '1';
        mappingProgress.innerHTML = `<span class="spinner"></span> Mapping: 0%`;

        let currentIdx = 0;
        const total = state.custom.data.length;
        const batchSize = 10; // Process 10 custom rows at a time

        function processBatch() {
            const end = Math.min(currentIdx + batchSize, total);

            for (; currentIdx < end; currentIdx++) {
                try {
                    const cIdx = currentIdx;
                    const customControl = state.custom.data[cIdx];
                    const customText = getColumnValue(customControl, state.custom.selectedColumn) || '';
                    const customIdRaw = getColumnValue(customControl, state.custom.idColumn);
                    const customId = (customIdRaw !== undefined && customIdRaw !== null && customIdRaw !== '') ? String(customIdRaw) : `C-${cIdx + 1}`;
                    const mapKey = (customIdRaw !== undefined && customIdRaw !== null && customIdRaw !== '') ? String(customIdRaw) : customText;

                    // Sync Scoring using cache
                    const matches = state.drata.data.map(drataControl => {
                        const drataText = getColumnValue(drataControl, state.drata.selectedColumn) || '';
                        const scores = calculateScoresSync(customText, drataText);
                        return { control: drataControl, ...scores };
                    })
                        .sort((a, b) => b[state.sortBy] - a[state.sortBy])
                        .slice(0, state.topX);

                    if (matches.length === 0) {
                        const emptyRow = document.createElement('tr');
                        const hasCustomId = customIdRaw !== null && customIdRaw !== undefined && String(customIdRaw).trim() !== '';
                        const primaryText = hasCustomId ? customId : customText;
                        const secondaryText = hasCustomId ? (customId !== customText ? customText : '') : `C-${cIdx + 1}`;

                        emptyRow.innerHTML = `
                                <td>${cIdx + 1}</td>
                                <td class="col-regulation"><strong>${primaryText}</strong>${secondaryText ? `<br><small>${secondaryText}</small>` : ''}</td>
                                <td colspan="5" class="empty-state">No suggestions above threshold</td>
                                <td class="col-select"></td>
                                <td class="col-comments"></td>
                                <td class="col-mapped"></td>
                                <td class="col-group-analysis"></td>
                            `;
                        fragment.appendChild(emptyRow);
                    } else {
                        matches.forEach((match, mIdx) => {
                            const drataValue = getColumnValue(match.control, state.drata.selectedColumn) || '';
                            let rawId = getColumnValue(match.control, state.drata.idColumn) || findBestId(match.control);
                            const drataIdDisplay = rawId ? String(rawId) : 'N/A';
                            const drataMappedId = rawId ? String(rawId) : drataValue;

                            const mappedIds = state.mappings[mapKey] || [];
                            const isMapped = Array.isArray(mappedIds) ? mappedIds.includes(drataMappedId) : mappedIds === drataMappedId; // Safely handle both
                            const commentKey = `${mapKey}-${drataMappedId}`;
                            const savedComment = state.comments[commentKey] || '';
                            const hasComment = savedComment && !savedComment.startsWith('🤖') && !savedComment.startsWith('⚠️');
                            const isAnalyzing = savedComment === "🤖 AI Analyzing gaps...";

                            const row = document.createElement('tr');
                            row.className = `match-row ${isMapped ? 'mapped' : ''}`;

                            const hasCustomId = customIdRaw !== null && customIdRaw !== undefined && String(customIdRaw).trim() !== '';
                            const primaryText = hasCustomId ? customId : customText;
                            const secondaryText = hasCustomId ? (customId !== customText ? customText : '') : `C-${cIdx + 1}`;

                            // Group analysis state
                            const groupComment = state.groupComments[mapKey] || '';
                            const isGroupAnalyzing = groupComment === "🤖 AI Analyzing grouped controls...";

                            row.innerHTML = `
                                    <td>${mIdx === 0 ? cIdx + 1 : ''}</td>
                                    <td class="col-regulation">${mIdx === 0 ? `<strong>${primaryText}</strong>${secondaryText ? `<br><small>${secondaryText}</small>` : ''}` : ''}</td>
                                    <td class="col-score">${Math.round(match.keyword)}%</td>
                                    <td class="col-semantics">${Math.round(match.semantic)}%</td>
                                    <td class="col-weighted">${Math.round(match.weighted)}%</td>
                                    <td class="col-id"><strong>${drataIdDisplay}</strong></td>
                                    <td class="col-control">${drataValue}</td>
                                    <td class="col-select">
                                        <div class="action-cell">
                                            <button class="upload-btn select-match-btn ${isAnalyzing ? 'analyzing' : ''}" ${isAnalyzing ? 'disabled' : ''}>
                                                ${isAnalyzing ? 'Analyzing...' : (hasComment ? 'Regenerate' : 'Analyze')}
                                            </button>
                                        </div>
                                     </td>
                                     <td class="col-comments"><div class="comment-wrapper"><textarea placeholder="Add notes..." class="comment-area">${savedComment}</textarea></div></td>
                                     <td class="col-mapped">
                                         <div class="action-cell">
                                             <input type="checkbox" class="mapped-checkbox" ${isMapped ? 'checked' : ''}>
                                         </div>
                                     </td>
                                     <td class="col-group-analysis">
                                         ${mIdx === 0 ? `
                                         <div class="action-cell" style="flex-direction: column; gap: 5px; align-items: stretch; padding: 5px; height: 100%; box-sizing: border-box;">
                                             <button class="upload-btn group-analyze-btn ${isGroupAnalyzing ? 'analyzing' : ''}" ${isGroupAnalyzing ? 'disabled' : ''} style="width: 100%; flex-shrink: 0;">
                                                 ${isGroupAnalyzing ? 'Analyzing Group...' : (groupComment ? 'Regenerate Group' : 'Group Analyze')}
                                             </button>
                                             <div class="comment-wrapper" style="flex: 1; min-height: 0;">
                                                 <textarea placeholder="Group analysis result..." class="group-comment-area comment-area" style="font-size: 11px; min-height: 60px;">${groupComment}</textarea>
                                             </div>
                                         </div>
                                         ` : ''}
                                     </td>
                                 `;

                            row.querySelector('.select-match-btn').addEventListener('click', () => {
                                const settingsError = validateGapAnalysisSettings();
                                if (settingsError) {
                                    alert(settingsError);
                                    return;
                                }

                                const commentKey = `${mapKey}-${drataMappedId}`;
                                state.comments[commentKey] = "🤖 AI Analyzing gaps...";
                                runGapAnalysis(mapKey, drataMappedId, drataValue, customText);
                                renderMappingTable();
                            });

                            row.querySelector('.comment-area').addEventListener('input', (e) => {
                                state.comments[commentKey] = e.target.value;
                                saveState();
                            });

                            row.querySelector('.mapped-checkbox').addEventListener('change', (e) => {
                                toggleMapping(mapKey, drataMappedId);
                                renderMappingTable();
                            });

                            if (mIdx === 0) {
                                row.querySelector('.group-analyze-btn').addEventListener('click', () => {
                                    const settingsError = validateGapAnalysisSettings();
                                    if (settingsError) {
                                        alert(settingsError);
                                        return;
                                    }

                                    const mappedIds = state.mappings[mapKey] || [];
                                    runGroupGapAnalysis(mapKey, mappedIds, customText);
                                });

                                row.querySelector('.group-comment-area').addEventListener('input', (e) => {
                                    state.groupComments[mapKey] = e.target.value;
                                    saveState();
                                });
                            }

                            fragment.appendChild(row);
                        });
                    }
                } catch (e) {
                    console.error("Mapping row error:", e);
                }
            }

            mappingBody.appendChild(fragment);
            fragment.replaceChildren(); // Clear fragment for next batch

            const progress = Math.round((currentIdx / total) * 100);
            mappingProgress.innerHTML = `<span class="spinner"></span> Mapping: ${progress}%`;

            if (currentIdx < total) {
                setTimeout(processBatch, 0); // Schedule next batch
            } else {
                mappingProgress.innerHTML = '✨ Mapping Complete';
                setTimeout(() => {
                    mappingProgress.style.opacity = '0';
                    setTimeout(() => mappingProgress.style.display = 'none', 500);
                }, 2000);
            }
        }

        processBatch();
    }

    function toggleMapping(customId, drataId) {
        if (!state.mappings[customId]) {
            state.mappings[customId] = [];
        }

        const ids = state.mappings[customId];
        if (ids.includes(drataId)) {
            state.mappings[customId] = ids.filter(id => id !== drataId);
            if (state.mappings[customId].length === 0) {
                delete state.mappings[customId];
            }
        } else {
            ids.push(drataId);
        }
        saveState();
    }

    async function runGroupGapAnalysis(customId, drataIds, customText) {
        if (!drataIds || drataIds.length === 0) {
            alert('No Control Library controls selected for this group.');
            return;
        }

        try {
            state.groupComments[customId] = "🤖 AI Analyzing grouped controls...";
            renderMappingTable();

            // Collect all mapped drata control texts
            const drataTexts = drataIds.map(dId => {
                const control = state.drata.data.find(d => {
                    let rawId = getColumnValue(d, state.drata.idColumn) || findBestId(d);
                    const currentDrataId = rawId ? String(rawId) : (getColumnValue(d, state.drata.selectedColumn) || '');
                    return currentDrataId === dId;
                });
                return control ? getColumnValue(control, state.drata.selectedColumn) : '';
            }).filter(t => t);

            const combinedDrataText = drataTexts.map((t, i) => `Control ${i + 1}: ${t}`).join('\n\n');

            const template = state.aiGroupPromptTemplate || DEFAULT_AI_GROUP_PROMPT_TEMPLATE;

            const prompt = template
                .replace(/{{customText}}/g, customText)
                .replace(/{{controlLibraryList}}/g, combinedDrataText);

            const result = await generateGapAnalysisText(prompt);

            if (result) {
                state.groupComments[customId] = result;
                saveState();
                renderMappingTable();
            }
        } catch (error) {
            console.error("Group Gap Analysis Error:", error);
            const message = formatAiErrorMessage(error);
            state.groupComments[customId] = message;
            updateLocalLlmStatus(message, true);
            renderMappingTable();
        }
    }

    async function runGapAnalysis(customId, drataId, drataText, customText) {
        const commentKey = `${customId}-${drataId}`;

        try {
            // Use custom template if available, otherwise fallback to default
            const template = state.aiPromptTemplate || DEFAULT_AI_PROMPT_TEMPLATE;

            const prompt = template
                .replace(/{{customText}}/g, customText)
                .replace(/{{controlLibraryText}}/g, drataText);

            const result = await generateGapAnalysisText(prompt);

            if (result) {
                state.comments[commentKey] = result;
                saveState();
                renderMappingTable(); // Refresh table to show results
            }
        } catch (error) {
            console.error("Gap Analysis Error:", error);
            const message = formatAiErrorMessage(error);
            state.comments[commentKey] = message;
            updateLocalLlmStatus(message, true);
            renderMappingTable();
        }
    }

    // File Upload Handlers
    if (drataInput) {
        drataInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            console.log("[Event] Drata file input changed");
            if (file) handleFileUpload(file, 'drata');
            drataInput.value = ''; // Reset so the same file can be selected again
        });
    }
    if (customInput) {
        customInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            console.log("[Event] Custom file input changed");
            if (file) handleFileUpload(file, 'custom');
            customInput.value = ''; // Reset so the same file can be selected again
        });
    }

    // Drop Zone Visuals
    if (drataInput) setupDropZone('drata-drop-zone', drataInput);
    if (customInput) setupDropZone('custom-drop-zone', customInput);

    function setupDropZone(id, input) {
        const zone = document.getElementById(id);
        if (!zone || !input) return;

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            if (e.dataTransfer.files.length) {
                handleFileUpload(e.dataTransfer.files[0], id.startsWith('drata') ? 'drata' : 'custom');
            }
        });
    }

    async function handleFileUpload(file, type) {
        if (!file) return;
        console.log(`[File Upload] Received file: ${file.name}, Size: ${file.size} bytes, Type: ${type}`);

        if (typeof XLSX === 'undefined') {
            alert('CRITICAL ERROR: Excel processing library (XLSX) not found. Please refresh the page or check your internet connection.');
            return;
        }

        try {
            state[type].filename = file.name;

            // Immediate UI feedback
            const statusEl = type === 'drata' ? drataStatus : customStatus;
            if (statusEl) {
                statusEl.textContent = 'Reading...';
                statusEl.classList.add('loading');
            }

            const reader = new FileReader();
            reader.onerror = () => {
                alert('Error reading file. Please try again.');
            };
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });

                    showSheetSelector(workbook, type);
                } catch (parseError) {
                    console.error("File Parse Error:", parseError);
                    alert('Error parsing Excel file. Please ensure it is a valid .xlsx or .xls file.');
                    updateUI(type); // Reset status
                }
            };
            reader.readAsArrayBuffer(file);
        } catch (uploadError) {
            console.error("Upload Error:", uploadError);
            alert('File upload failed. Check the console for details.');
        }
    }

    function showSheetSelector(workbook, type) {
        sheetList.innerHTML = '';
        workbook.SheetNames.forEach((name, index) => {
            const item = document.createElement('div');
            item.className = 'sheet-item';
            item.innerHTML = `
                <input type="checkbox" id="sheet-${index}" value="${name}" ${index === 0 ? 'checked' : ''}>
                <label for="sheet-${index}">${name}</label>
            `;
            item.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const checkbox = item.querySelector('input');
                    checkbox.checked = !checkbox.checked;
                }
            });
            sheetList.appendChild(item);
        });

        headerRowInput.value = 1; // Reset to default
        sheetModal.style.display = 'flex';

        // Clear previous listeners by cloning fresh from the DOM
        const oldConfirmBtn = document.getElementById('confirm-load-btn');
        const oldCancelBtn = document.getElementById('cancel-load-btn');
        const oldCloseBtn = document.getElementById('close-sheet-modal');

        const newConfirmBtn = oldConfirmBtn.cloneNode(true);
        const newCancelBtn = oldCancelBtn.cloneNode(true);
        const newCloseBtn = oldCloseBtn.cloneNode(true);

        oldConfirmBtn.parentNode.replaceChild(newConfirmBtn, oldConfirmBtn);
        oldCancelBtn.parentNode.replaceChild(newCancelBtn, oldCancelBtn);
        oldCloseBtn.parentNode.replaceChild(newCloseBtn, oldCloseBtn);

        newConfirmBtn.addEventListener('click', () => {
            const selectedSheets = Array.from(sheetList.querySelectorAll('input:checked')).map(cb => cb.value);
            if (selectedSheets.length === 0) {
                alert('Please select at least one tab to load.');
                return;
            }
            const headerRow = parseInt(headerRowInput.value) || 1;
            sheetModal.style.display = 'none';
            processSheets(workbook, selectedSheets, type, headerRow);
        });

        const closeModal = () => {
            sheetModal.style.display = 'none';
            updateUI(type); // Reset status
        };

        newCancelBtn.addEventListener('click', closeModal);
        newCloseBtn.addEventListener('click', closeModal);
    }

    function processSheets(workbook, selectedSheets, type, headerRow = 1) {
        try {
            let combinedData = [];
            selectedSheets.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                // range: headerRow - 1 because SheetJS uses 0-indexed rows
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { range: headerRow - 1 });
                combinedData = combinedData.concat(jsonData);
            });

            if (combinedData.length > 0) {
                console.log(`[processSheets] Data loaded: ${combinedData.length} rows`);
                state[type].data = combinedData;

                // Get all columns from all rows to ensure nothing is missed
                const allColumns = new Set();
                combinedData.forEach(row => {
                    Object.keys(row).forEach(key => allColumns.add(key));
                });
                const columns = Array.from(allColumns);
                console.log(`[processSheets] Columns detected:`, columns);
                state[type].columns = columns;

                // Smart auto-detection
                const idTerms = ['id', 'reference', 'ref', 'code', 'number', 'ctrl', 'control id'];
                const descTerms = ['description', 'text', 'title', 'name', 'control text'];

                state[type].idColumn = columns.find(c => idTerms.some(term => String(c).toLowerCase().includes(term))) || columns[0];
                state[type].selectedColumn = columns.find(c => descTerms.some(term => String(c).toLowerCase().includes(term))) || columns[0];

                console.log(`[processSheets] Calling updateUI(${type})`);
                updateUI(type);
                saveState();
            } else {
                alert('No data found in the selected tab(s).');
                updateUI(type);
            }
        } catch (error) {
            console.error("Processing Error:", error);
            alert('Error processing selected sheets.');
            updateUI(type);
        }
    }

    // Column Selection Handlers
    drataIdSelect.addEventListener('change', (e) => {
        state.drata.idColumn = e.target.value;
        renderPreview('drata');
        saveState();
    });

    drataSelect.addEventListener('change', (e) => {
        state.drata.selectedColumn = e.target.value;
        renderPreview('drata');
        updateSummary();
        saveState();
    });

    customSelect.addEventListener('change', (e) => {
        state.custom.selectedColumn = e.target.value;
        renderPreview('custom');
        updateSummary();
        renderMappingTable();
        saveState();
    });

    customIdSelect.addEventListener('change', (e) => {
        state.custom.idColumn = e.target.value;
        renderPreview('custom');
        renderMappingTable();
        saveState();
    });

    function updateUI(type) {
        const item = state[type];
        const statusEl = type === 'drata' ? drataStatus : customStatus;
        const filenameEl = type === 'drata' ? drataFilename : customFilename;
        const countEl = type === 'drata' ? drataRowCount : customRowCount;
        const containerEl = type === 'drata' ? drataColContainer : customColContainer;
        const selectEl = type === 'drata' ? drataSelect : customSelect;
        const idSelectEl = type === 'drata' ? drataIdSelect : customIdSelect;
        const previewContainer = document.getElementById(`${type}-preview-container`);

        if (item.data) {
            if (statusEl) {
                statusEl.textContent = 'Loaded';
                statusEl.classList.add('loaded');
            }
            if (filenameEl) filenameEl.textContent = item.filename;
            if (countEl) countEl.textContent = `(${item.data.length} rows loaded)`;
            if (containerEl) containerEl.style.display = 'flex';
            if (previewContainer) previewContainer.style.display = 'block';

            // Populate Dropdown
            if (selectEl) {
                selectEl.innerHTML = '';
                item.columns.forEach(col => {
                    const option = document.createElement('option');
                    option.value = col;
                    option.textContent = col;
                    if (col === item.selectedColumn) option.selected = true;
                    selectEl.appendChild(option);
                });
            }

            if (idSelectEl) { // Populate ID column for either Drata or Custom
                // Ensure idColumn is valid for current columns
                if (item.idColumn && !item.columns.includes(item.idColumn)) {
                    const idTerms = ['id', 'reference', 'ref', 'code', 'number', 'ctrl', 'control id'];
                    item.idColumn = item.columns.find(c => idTerms.some(term => c.toLowerCase().includes(term))) || item.columns[0];
                }

                idSelectEl.innerHTML = '';
                item.columns.forEach(col => {
                    const option = document.createElement('option');
                    option.value = col;
                    option.textContent = col;
                    if (col === item.idColumn) option.selected = true;
                    idSelectEl.appendChild(option);
                });
            }

            renderPreview(type);
        }

        updateSummary();
    }

    function renderPreview(type) {
        const item = state[type];
        const table = document.getElementById(`${type}-preview-table`);
        if (!item.data || !table) return;

        const columns = item.columns;
        const rows = item.data.slice(0, 5); // Just show first 5

        // Create colgroups for direct width control
        let colgroupHtml = '<colgroup>';
        columns.forEach((_, idx) => {
            colgroupHtml += `<col id="${type}-preview-col-${idx}" style="width: 200px;">`;
        });
        colgroupHtml += '</colgroup>';

        let html = colgroupHtml + '<thead><tr>';
        columns.forEach((col, idx) => {
            const isSelected = col === item.selectedColumn;
            const isId = type === 'drata' && col === item.idColumn;
            let cls = '';
            if (isSelected) cls = 'preview-selected';
            if (isId) cls = (cls ? cls + ' ' : '') + 'preview-id';

            html += `<th class="${cls}" data-col-index="${idx}">${col}${isSelected ? ' (Desc)' : ''}${isId ? ' (ID)' : ''}<div class="resizer"></div></th>`;
        });
        html += '</tr></thead><tbody>';

        rows.forEach(row => {
            html += '<tr>';
            columns.forEach(col => {
                const isSelected = col === item.selectedColumn;
                const isId = col === item.idColumn;
                let cls = '';
                if (isSelected) cls = 'preview-selected';
                if (isId) cls = (cls ? cls + ' ' : '') + 'preview-id';

                const val = getColumnValue(row, col);
                const displayVal = (val !== undefined && val !== null) ? String(val) : '';
                html += `<td class="${cls}">${displayVal}</td>`;
            });
            html += '</tr>';
        });

        html += '</tbody>';
        table.innerHTML = html;

        // Initialize resizers for this specific table
        initTableResizers(table, type + '-preview-col');
    }

    function updateSummary() {
        if (state.drata.data && state.custom.data) {
            summarySection.style.display = 'flex';
            drataPreview.textContent = state.drata.selectedColumn || 'None';
            customPreview.textContent = state.custom.selectedColumn || 'None';
        } else {
            summarySection.style.display = 'none';
        }
    }

    // Persistence Logic
    function saveState() {
        // We only save metadata and selections to LocalStorage to avoid quota issues with large datasets
        const { drata, custom, mappings, comments, groupComments, threshold, activeTab, stopwords, columnWidths, aiEnabled, modelSource, gapAnalysisEnabled, geminiApiKey, aiProvider, aiBaseUrl, aiModel, localLlmModel, aiPromptTemplate, aiGroupPromptTemplate, autoLoadModel, theme } = state;
        const stateToSave = { drata, custom, mappings, comments, groupComments, threshold, activeTab, stopwords, columnWidths, aiEnabled, modelSource, gapAnalysisEnabled, geminiApiKey, aiProvider, aiBaseUrl, aiModel, localLlmModel, aiPromptTemplate, aiGroupPromptTemplate, autoLoadModel, theme };

        try {
            localStorage.setItem('controlMapperState', JSON.stringify(stateToSave));
        } catch (e) {
            console.warn('LocalStorage quota exceeded, saving limited metadata');
            const metadataOnly = {
                ...stateToSave,
                drata: { ...drata, data: null },
                custom: { ...custom, data: null }
            };
            localStorage.setItem('controlMapperState', JSON.stringify(metadataOnly));
        }
    }

    function loadState() {
        const saved = localStorage.getItem('controlMapperState');
        if (saved) {
            const parsed = JSON.parse(saved);
            Object.assign(state, parsed);
            let migratedPromptTemplates = false;
            state.autoLoadModel = false;
            applyTheme(state.theme || 'dark');
            if (state.modelSource === 'custom') state.modelSource = 'github';
            if (!LOCAL_LLM_MODELS.includes(state.localLlmModel)) {
                state.localLlmModel = DEFAULT_LOCAL_LLM_MODEL;
            }
            if (state.aiProvider === 'browser-local') {
                state.aiModel = state.localLlmModel;
            }

            // Enforce defaults if saved as empty strings
            if (!state.aiPromptTemplate) state.aiPromptTemplate = DEFAULT_AI_PROMPT_TEMPLATE;
            if (!state.aiGroupPromptTemplate) state.aiGroupPromptTemplate = DEFAULT_AI_GROUP_PROMPT_TEMPLATE;

            // Migration: update old drata placeholders
            if (state.aiPromptTemplate) {
                state.aiPromptTemplate = state.aiPromptTemplate.replace(/{{drataText}}/g, '{{controlLibraryText}}');
            }
            if (state.aiGroupPromptTemplate) {
                state.aiGroupPromptTemplate = state.aiGroupPromptTemplate.replace(/{{drataControlsList}}/g, '{{controlLibraryList}}');
            }
            if (isOldSingleGapTemplate(state.aiPromptTemplate)) {
                state.aiPromptTemplate = DEFAULT_AI_PROMPT_TEMPLATE;
                migratedPromptTemplates = true;
            }
            if (isOldGroupGapTemplate(state.aiGroupPromptTemplate)) {
                state.aiGroupPromptTemplate = DEFAULT_AI_GROUP_PROMPT_TEMPLATE;
                migratedPromptTemplates = true;
            }
            if (migratedPromptTemplates) saveState();

            // Migration: convert old single mappings (string) to arrays
            if (state.mappings) {
                Object.keys(state.mappings).forEach(key => {
                    if (typeof state.mappings[key] === 'string') {
                        state.mappings[key] = [state.mappings[key]];
                    }
                });
            }

            // Sync UI Elements
            if (topXInput) topXInput.value = state.topX || 5;
            if (sortBySelect) sortBySelect.value = state.sortBy || 'semantic';
            if (aiToggle) aiToggle.checked = state.aiEnabled !== undefined ? state.aiEnabled : true;
            if (gapAnalysisToggle) gapAnalysisToggle.checked = state.gapAnalysisEnabled || false;
            if (!state.localLlmModel) state.localLlmModel = DEFAULT_LOCAL_LLM_MODEL;
            if (!state.aiProvider) state.aiProvider = 'browser-local';
            if (state.aiProvider === 'browser-local' && !state.aiModel) state.aiModel = state.localLlmModel;
            if (geminiApiKeyInput) geminiApiKeyInput.value = state.geminiApiKey || '';
            if (aiBaseUrlInput) aiBaseUrlInput.value = state.aiBaseUrl || '';
            syncAiProviderSettings();
            if (aiPromptTemplateInput) aiPromptTemplateInput.value = state.aiPromptTemplate || '';
            if (aiGroupPromptTemplateInput) aiGroupPromptTemplateInput.value = state.aiGroupPromptTemplate || '';
            if (autoLoadToggle) autoLoadToggle.checked = false;

            if (state.drata.data) updateUI('drata');
            if (state.custom.data) updateUI('custom');

            switchTab(state.activeTab || 'upload');
            if (state.activeTab === 'mapping') {
                renderMappingTable();
                applySavedColumnWidths();
            }
        }
        applyTheme(state.theme || 'dark');
        syncAiProviderSettings();
        showSemanticModelIdleStatus();
        updateUploadModelStatus();
        initResizableColumns();
    }

    function initResizableColumns() {
        const table = document.getElementById('mapping-table');
        if (!table) return;
        initTableResizers(table, 'col');
    }

    function initTableResizers(table, colIdPrefix) {
        const resizers = table.querySelectorAll('.resizer');

        resizers.forEach(resizer => {
            const th = resizer.parentElement;
            const colIndex = th.getAttribute('data-col-index');
            if (colIndex === null) return;

            const colEl = document.getElementById(`${colIdPrefix}-${colIndex}`);

            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const startX = e.pageX;
                const startWidth = colEl.offsetWidth || th.offsetWidth;

                resizer.classList.add('resizing');

                const onMouseMove = (moveEvent) => {
                    const width = startWidth + (moveEvent.pageX - startX);
                    if (width > 40) { // Min width
                        colEl.style.width = width + 'px';
                        if (colIdPrefix === 'col') { // Only save state for mapping table
                            state.columnWidths[`col-${colIndex}`] = width + 'px';
                        }
                    }
                };

                const onMouseUp = () => {
                    resizer.classList.remove('resizing');
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    if (colIdPrefix === 'col') saveState();
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        });
    }

    function applySavedColumnWidths() {
        Object.keys(state.columnWidths).forEach(colId => {
            const colEl = document.getElementById(colId);
            if (colEl) {
                colEl.style.width = state.columnWidths[colId];
            }
        });
    }
});
