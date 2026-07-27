import { promises as fs } from 'fs';
import path from 'path';
import { Document } from '@langchain/core/documents';
import { DirectoryLoader } from 'langchain/document_loaders/fs/directory';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { JSONLoader } from 'langchain/document_loaders/fs/json';
import { CSVLoader } from '@langchain/community/document_loaders/fs/csv';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio';

export interface LoadDocumentsOptions {
  inputPath: string;
  recursive?: boolean;
}

/** Binary/media types that cannot be meaningfully embedded as text. */
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.msi', '.zip', '.rar', '.7z', '.tar', '.gz',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.woff', '.woff2', '.ttf', '.eot',
]);

export function isBlockedExtension(filePath: string): boolean {
  return BLOCKED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isLoadableExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) return false;
  // Allow dedicated types and unknown extensions (attempt plain-text read).
  return true;
}

function enrichMetadata(doc: Document, absolutePath: string): Document {
  const ext = path.extname(absolutePath).toLowerCase();
  return new Document({
    pageContent: doc.pageContent,
    metadata: {
      ...doc.metadata,
      source: absolutePath,
      filename: path.basename(absolutePath),
      fileType: ext.replace('.', '') || 'unknown',
    },
  });
}

function createLoaderForFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return new PDFLoader(filePath);
    case '.docx':
      return new DocxLoader(filePath);
    case '.csv':
      return new CSVLoader(filePath);
    case '.json':
      return new JSONLoader(filePath);
    default:
      return new TextLoader(filePath);
  }
}

// Helper to recursively walk a directory and return all file paths
async function getFilesRecursively(dir: string): Promise<string[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    dirents.map(async (dirent) => {
      const res = path.resolve(dir, dirent.name);
      return dirent.isDirectory() ? getFilesRecursively(res) : res;
    })
  );
  return files.flat();
}

/**
 * Load an entire folder, picking a loader per file extension.
 * Supports loading any file extension by falling back to TextLoader,
 * and skips corrupted/binary files gracefully without failing the entire sync.
 */
export async function loadFolder(dirPath: string, recursive = true): Promise<Document[]> {
  const absolutePath = path.resolve(dirPath);
  let filePaths: string[] = [];

  try {
    if (recursive) {
      filePaths = await getFilesRecursively(absolutePath);
    } else {
      const dirents = await fs.readdir(absolutePath, { withFileTypes: true });
      filePaths = dirents
        .filter((dirent) => dirent.isFile())
        .map((dirent) => path.resolve(absolutePath, dirent.name));
    }
  } catch (err: any) {
    console.error(`[Loader] Failed to read directory ${absolutePath}: ${err.message}`);
    return [];
  }

  const documents: Document[] = [];
  for (const filePath of filePaths) {
    const filename = path.basename(filePath);
    if (isBlockedExtension(filePath)) {
      console.log(`[Loader] Skipping blocked extension for file: ${filename}`);
      continue;
    }

    try {
      const fileDocs = await loadSingleFile(filePath);
      documents.push(...fileDocs);
    } catch (err: any) {
      console.warn(`[Loader] Failed to load file ${filename}: ${err.message}. Skipping...`);
    }
  }

  console.log(`Loaded ${documents.length} documents from directory: ${absolutePath}`);
  return documents;
}

/**
 * Load a live web page (Cheerio strips the HTML to text).
 */
export async function loadUrl(url: string): Promise<Document[]> {
  const loader = new CheerioWebBaseLoader(url);
  const docs = await loader.load();
  console.log(`Loaded ${docs.length} documents from URL: ${url}`);
  return docs;
}

async function loadSingleFile(filePath: string): Promise<Document[]> {
  const absolutePath = path.resolve(filePath);

  if (isBlockedExtension(absolutePath)) {
    console.warn(`Skipping blocked file type: ${absolutePath}`);
    return [];
  }

  const loader = createLoaderForFile(absolutePath);
  const docs = await loader.load();
  return docs.map((doc: Document) => enrichMetadata(doc, absolutePath));
}

/**
 * Loads documents from a file, directory, or URL.
 */
export async function loadDocuments({ inputPath, recursive = true }: LoadDocumentsOptions): Promise<Document[]> {
  if (inputPath.startsWith('http://') || inputPath.startsWith('https://')) {
    return loadUrl(inputPath);
  }

  const absolutePath = path.resolve(inputPath);
  const stats = await fs.stat(absolutePath);

  if (stats.isFile()) {
    if (!isLoadableExtension(absolutePath)) {
      return [];
    }
    return loadSingleFile(absolutePath);
  }

  if (stats.isDirectory()) {
    return loadFolder(absolutePath, recursive);
  }

  return [];
}

/**
 * Load and index a single uploaded file path (used after frontend upload).
 */
export async function loadUploadedFile(filePath: string): Promise<Document[]> {
  return loadSingleFile(filePath);
}
