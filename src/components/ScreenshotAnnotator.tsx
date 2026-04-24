import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	AssetRecordType,
	Box,
	createShapeId,
	DefaultColorStyle,
	DefaultMainMenu,
	DefaultMainMenuContent,
	DefaultQuickActionsContent,
	DefaultSizeStyle,
	getSnapshot,
	STROKE_SIZES,
	Tldraw,
	TldrawImage,
	TldrawUiMenuContextProvider,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	toRichText,
	type Editor,
	type TLComponents,
	type TLEditorSnapshot,
	type TLPageId,
} from 'tldraw';
import { getAssetUrlsByImport } from '@tldraw/assets/imports.vite';
import 'tldraw/tldraw.css';

const assetUrls = getAssetUrlsByImport();

STROKE_SIZES.m = 7;
STROKE_SIZES.l = 10;
STROKE_SIZES.xl = 20;

const TLDRAW_LICENSE_KEY =
	'tldraw-2026-07-31/WyJQUVo1VG1jbCIsWyIqIl0sMTYsIjIwMjYtMDctMzEiXQ.CkPyjP0F73725rI7q6mqJHPO1raBBtGrGMD4brtu2PaIXIywy8PRtij6fcPZHLws627nS5OuHc2OPquvffbhog';

type Dimensions = { w: number; h: number };

const FRAME_ID = createShapeId('screenshot-frame');
const IMAGE_ID = createShapeId('screenshot-image');

const POINTERS = [
	{ id: createShapeId('screenshot-pointer-up'), emoji: '👆' },
	{ id: createShapeId('screenshot-pointer-left'), emoji: '👈' },
	{ id: createShapeId('screenshot-pointer-right'), emoji: '👉' },
	{ id: createShapeId('screenshot-pointer-down'), emoji: '👇' },
];

async function blobToDataUrl(blob: Blob): Promise<string> {
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

async function loadImageSize(src: string): Promise<Dimensions> {
	return await new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
		img.onerror = () => reject(new Error('Could not load image.'));
		img.src = src;
	});
}

function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

const CONFIG_FILE_STORAGE_KEY = 'sa.configFile';
const DEFAULT_CONFIG_PATH = '/Users/jan-hendrik/projects/jan-hendrik-mueller.de/content-dirs.json';
const FORMAT_STORAGE_KEY = 'sa.format';

type OutputFormat = 'jpeg' | 'png' | 'webp';

function isOutputFormat(value: string | null): value is OutputFormat {
	return value === 'jpeg' || value === 'png' || value === 'webp';
}

function isTauriRuntime(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function saveBlobToFolder(
	blob: Blob,
	folder: string,
	filename: string,
): Promise<string> {
	const { invoke } = await import('@tauri-apps/api/core');
	const buf = await blob.arrayBuffer();
	const bytes = Array.from(new Uint8Array(buf));
	const savedPath = await invoke<string>('save_image_to_folder', {
		folder,
		filename,
		bytes,
	});
	return savedPath;
}

export default function ScreenshotAnnotator() {
	const editorRef = useRef<Editor | null>(null);
	const dimsRef = useRef<Dimensions | null>(null);

	const [dims, setDims] = useState<Dimensions | null>(null);
	const [status, setStatus] = useState<string | null>(null);

	const [downsamplePrompt, setDownsamplePrompt] = useState<Dimensions | null>(null);
	const downsampleResolverRef = useRef<((scale: boolean) => void) | null>(null);

	const askDownsample = useCallback((d: Dimensions): Promise<boolean> => {
		return new Promise((resolve) => {
			downsampleResolverRef.current = resolve;
			setDownsamplePrompt(d);
		});
	}, []);

	const resolveDownsample = useCallback((scale: boolean) => {
		downsampleResolverRef.current?.(scale);
		downsampleResolverRef.current = null;
		setDownsamplePrompt(null);
	}, []);

	const [isEditing, setIsEditing] = useState(true);
	const [snapshot, setSnapshot] = useState<TLEditorSnapshot | undefined>();
	const [previewPageId, setPreviewPageId] = useState<TLPageId | undefined>();
	const [previewBounds, setPreviewBounds] = useState<Box | null>(null);
	const [isDarkMode, setIsDarkMode] = useState(false);
	const [isEditorReady, setIsEditorReady] = useState(false);
	const hasStartupCapturedRef = useRef(false);

	useEffect(() => {
		dimsRef.current = dims;
	}, [dims]);

	const loadScreenshot = useCallback(async (blob: Blob) => {
		const editor = editorRef.current;
		if (!editor) {
			setStatus('Switch to edit mode before pasting a new screenshot.');
			return;
		}

		setStatus(null);

		const dataUrl = await blobToDataUrl(blob);
		const original = await loadImageSize(dataUrl);
		let { w, h } = original;

		if (h > 1000) {
			const shouldScale = await askDownsample(original);
			if (shouldScale) {
				w = Math.round(w / 2);
				h = Math.round(h / 2);
			}
		}

		editor.run(
			() => {
				if (editor.getShape(FRAME_ID)) editor.deleteShape(FRAME_ID);
				for (const p of POINTERS) {
					if (editor.getShape(p.id)) editor.deleteShape(p.id);
				}

				const assetId = AssetRecordType.createId();
				editor.createAssets([
					{
						id: assetId,
						type: 'image',
						typeName: 'asset',
						props: {
							name: 'screenshot.png',
							src: dataUrl,
							w,
							h,
							mimeType: blob.type || 'image/png',
							isAnimated: false,
						},
						meta: {},
					},
				]);

				editor.createShape({
					id: FRAME_ID,
					type: 'frame',
					x: 0,
					y: 0,
					props: { w, h },
				});

				editor.createShape({
					id: IMAGE_ID,
					type: 'image',
					parentId: FRAME_ID,
					x: 0,
					y: 0,
					isLocked: true,
					props: { assetId, w, h },
				});

				const pointerScale = Math.min(12, Math.max(0.5, Math.max(w, h) / 800));
				const pointerX = w + Math.round(24 * pointerScale);
				const pointerGap = 12 * pointerScale;
				let pointerY = 0;
				for (const p of POINTERS) {
					editor.createShape({
						id: p.id,
						type: 'text',
						x: pointerX,
						y: pointerY,
						props: {
							richText: toRichText(p.emoji),
							size: 'xl',
							scale: pointerScale,
							autoSize: true,
						},
					});
					const b = editor.getShapePageBounds(p.id);
					pointerY += (b ? b.h : 60 * pointerScale) + pointerGap;
				}
			},
			{ history: 'ignore', ignoreShapeLock: true },
		);

		const frameBounds = editor.getShapePageBounds(FRAME_ID);
		const pointerBoundsList = POINTERS.map((p) => editor.getShapePageBounds(p.id)).filter(
			(b): b is Box => !!b,
		);
		const allBounds = [frameBounds, ...pointerBoundsList].filter((b): b is Box => !!b);
		const zoomBounds = allBounds.length > 0 ? Box.Common(allBounds) : null;
		if (zoomBounds) {
			editor.zoomToBounds(zoomBounds, { inset: 48, animation: { duration: 200 } });
		}

		setDims({ w, h });
	}, [askDownsample]);

	const captureScreenshot = useCallback(async () => {
		if (!isTauriRuntime()) {
			setStatus('Screen capture is only available in the desktop app.');
			return;
		}
		setStatus(null);
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			const bytes = await invoke<number[]>('capture_screenshot');
			const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
			await loadScreenshot(blob);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			// Sentinels from the Rust side.
			if (message === 'cancelled') return;
			if (message === 'permission_denied') {
				setStatus('Screen Recording permission required — System Settings opened, grant access and try again.');
				return;
			}
			setStatus(`Could not capture screenshot: ${message}`);
		}
	}, [loadScreenshot]);

	// On desktop, launch straight into the selection tool: the window stays
	// hidden (per tauri.conf) until the Rust side reveals it at the end of
	// `capture_screenshot`. Gated on the editor being mounted so the incoming
	// screenshot never races tldraw's init.
	useEffect(() => {
		if (!isTauriRuntime()) return;
		if (!isEditorReady) return;
		if (hasStartupCapturedRef.current) return;
		hasStartupCapturedRef.current = true;
		void captureScreenshot();
	}, [isEditorReady, captureScreenshot]);

	const pasteFromClipboard = useCallback(async () => {
		const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
		if (isTauri) {
			try {
				// Read the raw PNG bytes directly from the macOS pasteboard so the
				// embedded ICC profile (e.g. Display P3) is preserved. Going through
				// readImage().rgba() → canvas strips the color profile and makes the
				// image look washed out.
				const { invoke } = await import('@tauri-apps/api/core');
				const bytes = await invoke<number[]>('read_clipboard_png');
				const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
				await loadScreenshot(blob);
			} catch {
				setStatus('No image found in the clipboard.');
			}
			return;
		}

		if (!navigator.clipboard || !navigator.clipboard.read) {
			setStatus('Clipboard API not available. Use Ctrl/Cmd + V instead.');
			return;
		}
		try {
			const items = await navigator.clipboard.read();
			for (const item of items) {
				const imageType = item.types.find((t) => t.startsWith('image/'));
				if (imageType) {
					const blob = await item.getType(imageType);
					await loadScreenshot(blob);
					return;
				}
			}
			setStatus('No image found in the clipboard.');
		} catch {
			setStatus('Could not read clipboard. Try Ctrl/Cmd + V instead.');
		}
	}, [loadScreenshot]);

	useEffect(() => {
		const handler = (event: ClipboardEvent) => {
			if (!event.clipboardData) return;
			for (const item of event.clipboardData.items) {
				if (item.type.startsWith('image/')) {
					const blob = item.getAsFile();
					if (blob) {
						event.preventDefault();
						event.stopPropagation();
						void loadScreenshot(blob);
					}
					return;
				}
			}
		};
		window.addEventListener('paste', handler, true);
		return () => window.removeEventListener('paste', handler, true);
	}, [loadScreenshot]);

	const [format, setFormat] = useState<OutputFormat>(() => {
		if (typeof window === 'undefined') return 'jpeg';
		try {
			const stored = window.localStorage.getItem(FORMAT_STORAGE_KEY);
			return isOutputFormat(stored) ? stored : 'jpeg';
		} catch {
			return 'jpeg';
		}
	});
	useEffect(() => {
		if (typeof window === 'undefined') return;
		try {
			window.localStorage.setItem(FORMAT_STORAGE_KEY, format);
		} catch {
			// ignore storage errors (e.g. private mode)
		}
	}, [format]);

	const [configFilePath, setConfigFilePath] = useState<string>(() => {
		if (typeof window === 'undefined') return DEFAULT_CONFIG_PATH;
		try {
			return window.localStorage.getItem(CONFIG_FILE_STORAGE_KEY) ?? DEFAULT_CONFIG_PATH;
		} catch {
			return DEFAULT_CONFIG_PATH;
		}
	});
	useEffect(() => {
		if (typeof window === 'undefined') return;
		try {
			window.localStorage.setItem(CONFIG_FILE_STORAGE_KEY, configFilePath);
		} catch {
			// ignore storage errors (e.g. private mode)
		}
	}, [configFilePath]);

	const [outputFolder, setOutputFolder] = useState<string>('');
	const [imgSrcPrefix, setImgSrcPrefix] = useState<string>('');

	const loadConfig = useCallback(async () => {
		if (!isTauriRuntime() || !configFilePath.trim()) return;
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			const content = await invoke<string>('read_text_file', { path: configFilePath });
			const config = JSON.parse(content) as Record<string, unknown>;
			setOutputFolder(typeof config.outputFolder === 'string' ? config.outputFolder : '');
			setImgSrcPrefix(typeof config.imgSrcPrefix === 'string' ? config.imgSrcPrefix : '');
		} catch {
			setOutputFolder('');
			setImgSrcPrefix('');
		}
	}, [configFilePath]);

	useEffect(() => {
		void loadConfig();
	}, [loadConfig]);

	const [showSettings, setShowSettings] = useState(false);

	const pickConfigFile = useCallback(async () => {
		if (!isTauriRuntime()) return;
		try {
			const { open } = await import('@tauri-apps/plugin-dialog');
			const selected = await open({
				multiple: false,
				title: 'Choose config file',
				filters: [{ name: 'JSON', extensions: ['json'] }],
				defaultPath: configFilePath.trim() || undefined,
			});
			if (typeof selected === 'string' && selected.length > 0) {
				setConfigFilePath(selected);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setStatus(`Could not open file picker: ${message}`);
		}
	}, [configFilePath]);

	const [toast, setToast] = useState<string | null>(null);
	const toastTimerRef = useRef<number | null>(null);
	const showToast = useCallback((message: string) => {
		setToast(message);
		if (toastTimerRef.current !== null) {
			window.clearTimeout(toastTimerRef.current);
		}
		toastTimerRef.current = window.setTimeout(() => {
			setToast(null);
			toastTimerRef.current = null;
		}, 2500);
	}, []);
	useEffect(() => {
		return () => {
			if (toastTimerRef.current !== null) {
				window.clearTimeout(toastTimerRef.current);
			}
		};
	}, []);

	const [savedImage, setSavedImage] = useState<{ filename: string } | null>(null);
	const [copiedKey, setCopiedKey] = useState<string | null>(null);
	const copyTimerRef = useRef<number | null>(null);
	const copySnippet = useCallback(async (key: string, text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedKey(key);
			if (copyTimerRef.current !== null) {
				window.clearTimeout(copyTimerRef.current);
			}
			copyTimerRef.current = window.setTimeout(() => {
				setCopiedKey(null);
				copyTimerRef.current = null;
			}, 1500);
		} catch {
			// ignore clipboard errors
		}
	}, []);
	useEffect(() => {
		return () => {
			if (copyTimerRef.current !== null) {
				window.clearTimeout(copyTimerRef.current);
			}
		};
	}, []);
	useEffect(() => {
		if (!savedImage) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setSavedImage(null);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [savedImage]);

	const downloadImage = useCallback(async () => {
		const editor = editorRef.current;
		if (!editor) return;
		const hasFrame = !!editor.getShape(FRAME_ID);
		const shapeIds = hasFrame
			? [FRAME_ID]
			: [...editor.getCurrentPageShapeIds()];
		if (shapeIds.length === 0) {
			setStatus('Nothing to export yet.');
			return;
		}
		try {
			const { blob } = await editor.toImage(shapeIds, {
				format,
				background: true,
				padding: 0,
				scale: 1,
				pixelRatio: 1,
				quality: 0.92,
			});
			const ext = format === 'jpeg' ? 'jpg' : format;
			const filename = `annotated-${Date.now()}.${ext}`;

			const trimmedFolder = outputFolder.trim();
			if (trimmedFolder && isTauriRuntime()) {
				try {
					const savedPath = await saveBlobToFolder(blob, trimmedFolder, filename);
					setStatus(null);
					showToast(`Saved to ${savedPath}`);
					setSavedImage({ filename });
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					setStatus(`Could not save to folder: ${message}`);
				}
				return;
			}

			downloadBlob(blob, filename);
			showToast(`Saved ${filename}`);
			setSavedImage({ filename });
		} catch {
			setStatus(`Could not generate ${format.toUpperCase()}.`);
		}
	}, [format, outputFolder, showToast]);

	const clearAll = useCallback(() => {
		const editor = editorRef.current;
		if (!editor) return;
		editor.run(
			() => {
				const shapeIds = [...editor.getCurrentPageShapeIds()];
				if (shapeIds.length > 0) {
					editor.deleteShapes(shapeIds);
				}
				const assetIds = editor.getAssets().map((a) => a.id);
				if (assetIds.length > 0) {
					editor.deleteAssets(assetIds);
				}
			},
			{ history: 'ignore', ignoreShapeLock: true },
		);
		setDims(null);
		setStatus(null);
	}, []);

	const tldrawComponents = useMemo<TLComponents>(
		() => ({
			MainMenu: () => (
				<DefaultMainMenu>
					<TldrawUiMenuGroup id="annotator-actions">
						<TldrawUiMenuItem
							id="clear-all"
							label="Clear all"
							icon="cross-2"
							readonlyOk={false}
							onSelect={clearAll}
						/>
					</TldrawUiMenuGroup>
					<DefaultMainMenuContent />
				</DefaultMainMenu>
			),
			QuickActions: () => (
				<TldrawUiMenuContextProvider type="small-icons" sourceId="quick-actions">
					<DefaultQuickActionsContent />
					<TldrawUiMenuItem
						id="clear-all"
						label="Clear all"
						icon="cross-2"
						readonlyOk={false}
						onSelect={clearAll}
					/>
				</TldrawUiMenuContextProvider>
			),
		}),
		[clearAll],
	);

	const enterPreview = useCallback(() => {
		const editor = editorRef.current;
		if (!editor) return;
		const shapeIds = editor.getCurrentPageShapeIds();
		if (shapeIds.size === 0) {
			setStatus('Nothing to preview yet.');
			return;
		}
		const frameBounds = editor.getShapePageBounds(FRAME_ID);
		const bounds = frameBounds
			? new Box(frameBounds.x, frameBounds.y, frameBounds.w, frameBounds.h)
			: editor.getViewportPageBounds();
		setIsDarkMode(editor.user.getIsDarkMode());
		setPreviewPageId(editor.getCurrentPageId());
		setPreviewBounds(bounds);
		setSnapshot(getSnapshot(editor.store));
		setStatus(null);
		setIsEditing(false);
	}, []);

	const exitPreview = useCallback(() => {
		setIsEditing(true);
	}, []);

	const [showAbout, setShowAbout] = useState(false);

	useEffect(() => {
		if (!showAbout) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setShowAbout(false);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [showAbout]);

	useEffect(() => {
		if (!showSettings) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setShowSettings(false);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [showSettings]);

	useEffect(() => {
		if (!downsamplePrompt) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') resolveDownsample(false);
			else if (e.key === 'Enter') resolveDownsample(true);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [downsamplePrompt, resolveDownsample]);

	return (
		<div className="sa-root">
			<div className="sa-toolbar">
				<div className="sa-group">
					<div className="sa-stack">
						<div className="sa-row">
							{isTauriRuntime() && (
								<button
									type="button"
									className="sa-button"
									onClick={captureScreenshot}
									disabled={!isEditing}
									title={
										isEditing
											? 'Hide the app and capture a region of the screen'
											: 'Switch to edit mode to capture'
									}
								>
									Capture screenshot
								</button>
							)}
							<button
								type="button"
								className="sa-button"
								onClick={pasteFromClipboard}
								disabled={!isEditing}
								title={isEditing ? undefined : 'Switch to edit mode to paste'}
							>
								Paste screenshot
							</button>
						</div>
						<span className="sa-hint">
							{isTauriRuntime() ? (
								<>
									capture, or paste with <kbd>⌘</kbd> + <kbd>V</kbd>
								</>
							) : (
								<>
									or press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>V</kbd>
								</>
							)}
						</span>
					</div>
				</div>

				<span className="sa-sep sa-sep--tight" aria-hidden="true" />

				<div className="sa-group sa-group--export">
					<button type="button" className="sa-button sa-button--primary" onClick={downloadImage}>
						{outputFolder.trim() && isTauriRuntime() ? 'Save' : 'Download'}{' '}
						{format.toUpperCase()}
					</button>

					{isEditing ? (
						<button type="button" className="sa-button" onClick={enterPreview}>
							Preview
						</button>
					) : (
						<button type="button" className="sa-button" onClick={exitPreview}>
							Edit drawing
						</button>
					)}

					{toast && (
						<span className="sa-toast" role="status" aria-live="polite">
							{toast}
						</span>
					)}
				</div>

				<span className="sa-spacer" aria-hidden="true" />

				<div className="sa-group sa-group--right">
					{status && <span className="sa-status">{status}</span>}
					{dims && (
						<span className="sa-dims" title="Screenshot dimensions">
							{dims.w.toLocaleString()} × {dims.h.toLocaleString()} px
						</span>
					)}

					<span className="sa-sep" aria-hidden="true" />

					<button
						type="button"
						className="sa-icon-button"
						onClick={() => setShowSettings(true)}
						aria-haspopup="dialog"
						aria-expanded={showSettings}
						aria-label="Settings"
						title="Settings"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="3" />
							<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
						</svg>
					</button>

					<button
						type="button"
						className="sa-button sa-button--ghost"
						onClick={() => setShowAbout(true)}
						aria-haspopup="dialog"
						aria-expanded={showAbout}
					>
						Info
					</button>
				</div>
			</div>

			<div className="sa-canvas">
				{isEditing ? (
					<Tldraw
						licenseKey={TLDRAW_LICENSE_KEY}
						assetUrls={assetUrls}
						snapshot={snapshot}
						components={tldrawComponents}
						onMount={(editor) => {
							editorRef.current = editor;
							editor.setStyleForNextShapes(DefaultColorStyle, 'orange');
							editor.setStyleForNextShapes(DefaultSizeStyle, 'xl');
							editor.setCurrentTool('draw');
							if (snapshot) {
								editor.user.updateUserPreferences({
									colorScheme: isDarkMode ? 'dark' : 'light',
								});
								if (previewPageId) editor.setCurrentPage(previewPageId);
							}
							setIsEditorReady(true);
						}}
					/>
				) : snapshot && previewBounds ? (
					<TldrawImage
						licenseKey={TLDRAW_LICENSE_KEY}
						assetUrls={assetUrls}
						snapshot={snapshot}
						pageId={previewPageId}
						background={true}
						darkMode={isDarkMode}
						bounds={previewBounds}
						padding={0}
						scale={1}
						format="png"
					/>
				) : null}
			</div>

			{showSettings && (
				<div
					className="sa-about-backdrop"
					role="dialog"
					aria-modal="true"
					aria-label="Settings"
					onClick={() => setShowSettings(false)}
				>
					<div className="sa-about-dialog" onClick={(e) => e.stopPropagation()}>
						<button
							type="button"
							className="sa-about-close"
							aria-label="Close"
							onClick={() => setShowSettings(false)}
						>
							×
						</button>
						<h2>Settings</h2>

						<h3>Config file</h3>
						<p>JSON file that defines the output folder. Edit it to switch blog posts.</p>
						<div className="sa-input-wrap sa-input-wrap--block">
							<input
								type="text"
								className="sa-input sa-input--block"
								value={configFilePath}
								onChange={(e) => setConfigFilePath(e.target.value)}
								placeholder="/path/to/content-dirs.json"
								spellCheck={false}
								autoCorrect="off"
								autoCapitalize="off"
							/>
							{isTauriRuntime() && (
								<button
									type="button"
									className="sa-input-icon"
									aria-label="Choose config file"
									title="Choose file…"
									onClick={pickConfigFile}
								>
									<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
										<path d="M1.5 4.5a1 1 0 0 1 1-1h3.3l1.4 1.4h6.3a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4.5Z" />
									</svg>
								</button>
							)}
						</div>
						{outputFolder && (
							<p style={{ marginTop: '0.5rem', fontSize: '0.7rem', opacity: 0.65, wordBreak: 'break-all' }}>
								→ {outputFolder}
							</p>
						)}
						{isTauriRuntime() && (
							<div style={{ marginTop: '0.4rem' }}>
								<button
									type="button"
									className="sa-button"
									style={{ fontSize: '0.7rem', padding: '0.3rem 0.6rem' }}
									onClick={loadConfig}
								>
									Reload config
								</button>
							</div>
						)}

						<h3>Export format</h3>
						<p>Format used when saving or downloading annotated screenshots.</p>
						<div className="sa-segment" role="group" aria-label="Export format">
							{(['jpeg', 'png', 'webp'] as const).map((f) => (
								<button
									key={f}
									type="button"
									className={`sa-segment-btn${format === f ? ' is-active' : ''}`}
									onClick={() => setFormat(f)}
									aria-pressed={format === f}
								>
									{f.toUpperCase()}
								</button>
							))}
						</div>

						<div className="sa-about-actions">
							<button
								type="button"
								className="sa-button"
								onClick={() => setShowSettings(false)}
							>
								Close
							</button>
						</div>
					</div>
				</div>
			)}

			{showAbout && (
				<div
					className="sa-about-backdrop"
					role="dialog"
					aria-modal="true"
					aria-label="About this tool"
					onClick={() => setShowAbout(false)}
				>
					<div className="sa-about-dialog" onClick={(e) => e.stopPropagation()}>
						<button
							type="button"
							className="sa-about-close"
							aria-label="Close"
							onClick={() => setShowAbout(false)}
						>
							×
						</button>
						<h2>About</h2>
						<p>This is a quick and minimal screenshot annotator tool.</p>

						<h3>How it works</h3>
						<ol>
							<li>Add the screenshot</li>
							<li>Make annotations</li>
							<li>Download the result</li>
						</ol>
						<p>Image dimensions are preserved.</p>

						<h3>Privacy</h3>
						<p>
							All data processing happens locally on your machine. Nothing is uploaded or sent to
							any server — your screenshots never leave your app.
						</p>
						<p>
							Nothing is stored either — pasting another screenshot or reloading the app will
							clear everything.
						</p>

						<h3>Credits</h3>
						<p>
							Built with{' '}
							<a href="https://tldraw.dev" target="_blank" rel="noreferrer">
								tldraw
							</a>
							.
						</p>
					</div>
				</div>
			)}

			{savedImage && (() => {
				const snippet = `<img src="${imgSrcPrefix}${savedImage.filename}" />`;
				return (
					<div
						className="sa-about-backdrop"
						role="dialog"
						aria-modal="true"
						aria-label="Image saved"
						onClick={() => setSavedImage(null)}
					>
						<div className="sa-about-dialog" onClick={(e) => e.stopPropagation()}>
							<button
								type="button"
								className="sa-about-close"
								aria-label="Close"
								onClick={() => setSavedImage(null)}
							>
								×
							</button>
							<h2>Image saved</h2>
							<div className="sa-snippet">
								<div className="sa-snippet-row">
									<code className="sa-snippet-code">{snippet}</code>
									<button
										type="button"
										className="sa-button"
										onClick={() => copySnippet('filename', snippet)}
									>
										{copiedKey === 'filename' ? 'Copied' : 'Copy'}
									</button>
								</div>
							</div>
							<div className="sa-about-actions">
								<button
									type="button"
									className="sa-button sa-button--primary"
									onClick={async () => {
										if (isTauriRuntime()) {
											const { invoke } = await import('@tauri-apps/api/core');
											await invoke('quit');
										} else {
											setSavedImage(null);
										}
									}}
								>
									Close App
								</button>
							</div>
						</div>
					</div>
				);
			})()}

			{downsamplePrompt && (
				<div
					className="sa-about-backdrop sa-about-backdrop--upper"
					role="dialog"
					aria-modal="true"
					aria-label="High-res screenshot"
					onClick={() => resolveDownsample(false)}
				>
					<div className="sa-about-dialog" onClick={(e) => e.stopPropagation()}>
						<h2>High-res screenshot detected</h2>
						<p>
							This screenshot is{' '}
							<strong>
								{downsamplePrompt.w} × {downsamplePrompt.h}px
							</strong>
							.
						</p>
						<p>Do you want to scale dimensions down by a factor of 2?</p>
						<div className="sa-about-actions sa-about-actions--center">
							<button
								type="button"
								className="sa-button"
								onClick={() => resolveDownsample(false)}
							>
								Keep original
							</button>
							<button
								type="button"
								className="sa-button sa-button--primary"
								onClick={() => resolveDownsample(true)}
								autoFocus
							>
								Scale down 2×
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
