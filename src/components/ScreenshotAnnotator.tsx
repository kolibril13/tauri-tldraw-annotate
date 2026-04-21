import { useCallback, useEffect, useRef, useState } from 'react';
import {
	AssetRecordType,
	Box,
	createShapeId,
	DefaultColorStyle,
	DefaultSizeStyle,
	getSnapshot,
	STROKE_SIZES,
	Tldraw,
	TldrawImage,
	toRichText,
	type Editor,
	type TLEditorSnapshot,
	type TLPageId,
} from 'tldraw';
import 'tldraw/tldraw.css';

STROKE_SIZES.m = 7;
STROKE_SIZES.l = 10;
STROKE_SIZES.xl = 20;

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

	const pasteFromClipboard = useCallback(async () => {
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

	const [format, setFormat] = useState<'jpeg' | 'png' | 'webp'>('jpeg');

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
				quality: 0.92,
			});
			const ext = format === 'jpeg' ? 'jpg' : format;
			downloadBlob(blob, `annotated-${Date.now()}.${ext}`);
		} catch {
			setStatus(`Could not generate ${format.toUpperCase()}.`);
		}
	}, [format]);

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
				<button
					type="button"
					className="sa-button"
					onClick={pasteFromClipboard}
					disabled={!isEditing}
					title={isEditing ? undefined : 'Switch to edit mode to paste'}
				>
					Paste screenshot
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

				<button type="button" className="sa-button" onClick={downloadImage}>
					Download {format.toUpperCase()}
				</button>

				<span className="sa-hint">
					or press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>V</kbd>
				</span>
				{dims && (
					<span className="sa-dims">
						{dims.w} × {dims.h}px
					</span>
				)}
				{status && <span className="sa-status">{status}</span>}

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

			<div className="sa-canvas">
				{isEditing ? (
					<Tldraw
						snapshot={snapshot}
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
						}}
					/>
				) : snapshot && previewBounds ? (
					<TldrawImage
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
