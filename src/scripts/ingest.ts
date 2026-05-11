import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OllamaEmbeddings } from "@langchain/ollama";
import path from "path";
import fs from "fs";

// Bypass strict SSL certificate checks for government portals that use custom CAs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const PORTAL_URL = "https://maitri.maharashtra.gov.in/";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const EMBEDDING_MODEL = "bge-m3"; // Crucial for Multilingual Marathi/Hindi capabilities
const VECTOR_STORE_FILE = path.resolve(__dirname, "../../vector_store.json");

async function ingest() {
  try {
    console.log(`Starting to scrape data from: ${PORTAL_URL}`);
    
    // 1. Scrape the URL
    const loader = new CheerioWebBaseLoader(PORTAL_URL);
    const docs = await loader.load();
    console.log(`Loaded ${docs.length} web page(s). Extracting text...`);

    // 2. Clean and Chunk the text
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const splitDocs = await textSplitter.splitDocuments(docs);
    console.log(`Split text into ${splitDocs.length} chunks.`);

    // 3. Create Vector Store with Ollama Embeddings
    console.log(`Generating embeddings using Ollama (${EMBEDDING_MODEL}). This might take a minute...`);
    const embeddings = new OllamaEmbeddings({
      baseUrl: OLLAMA_BASE_URL,
      model: EMBEDDING_MODEL,
    });
    
    const plainTexts = splitDocs.map(d => d.pageContent);
    const vectors = await embeddings.embedDocuments(plainTexts);
    
    const db = splitDocs.map((doc, i) => ({
      pageContent: doc.pageContent,
      embedding: vectors[i]
    }));

    // 4. Save to Disk as simple JSON (Requires no C++ compilation!)
    fs.writeFileSync(VECTOR_STORE_FILE, JSON.stringify(db), "utf8");
    console.log(`Successfully saved Vector Database to ${VECTOR_STORE_FILE}`);

  } catch (error) {
    console.error("Error during ingestion:", error);
    process.exit(1);
  }
}

ingest();
