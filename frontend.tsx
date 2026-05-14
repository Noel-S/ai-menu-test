import { createRoot } from "react-dom/client";
import { useState, useRef, useCallback, useEffect } from "react";
import { codeToHtml } from "shiki";
import "./index.css";

function JsonHighlight({ data }: { data: unknown }) {
  const [html, setHtml] = useState<string | null>(null);
  const code = JSON.stringify(data, null, 2);

  useEffect(() => {
    codeToHtml(code, { lang: "json", theme: "github-dark" }).then(setHtml);
  }, [code]);

  if (!html) return <pre className="shiki-pre">{code}</pre>;
  return <div className="shiki-wrap" dangerouslySetInnerHTML={{ __html: html }} />;
}

type JobStatus = {
  jobId: string;
  error: string | undefined;
  status: "processing" | "finished";
  data: unknown;
};

type UploadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "polling"; jobId: string }
  | { status: "success"; data: unknown }
  | { status: "error"; message: string };

function App() {
  const [baseUrl, setBaseUrl] = useState("https://api.localhost");
  const [businessId, setBusinessId] = useState("");
  const [token, setToken] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    if (state.status !== "polling") {
      stopPolling();
      return;
    }

    const { jobId } = state;
    const url = `${baseUrl.replace(/\/$/, "")}/api/v3/products/ai/menu/${businessId.trim()}/${jobId}`;
    const headers: Record<string, string> = {};
    if (token.trim()) headers["Authorization"] = token.trim();

    const poll = async () => {
      try {
        const res = await fetch(url, { headers });
        if (res.status === 404) {
          stopPolling();
          setState({ status: "error", message: "Job not found" });
          return;
        }
        const json = await res.json();
        if (!res.ok) {
          stopPolling();
          const errors = json.errors?.join(", ") ?? json.message ?? "Unknown error";
          setState({ status: "error", message: `${res.status}: ${errors}` });
          return;
        }
        const job: JobStatus = json.data;
        if (job.status === "finished") {
          stopPolling();
          if (job.error) {
            setState({ status: "error", message: job.error });
          } else {
            setState({ status: "success", data: job.data });
          }
        }
      } catch (err) {
        stopPolling();
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      }
    };

    poll();
    pollRef.current = setInterval(poll, 3000);
  }, [state.status === "polling" ? state.jobId : null]);

  const handleFile = (f: File) => {
    if (!f.type.startsWith("image/")) {
      setState({ status: "error", message: "Only image files are supported." });
      return;
    }
    setFile(f);
    setState({ status: "idle" });
    const url = URL.createObjectURL(f);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setState({ status: "loading" });

    try {
      const buffer = await file.arrayBuffer();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const headers: Record<string, string> = {
        "Content-Type": file.type,
        "x-file-extension": ext,
      };
      if (token.trim()) {
        headers["Authorization"] = token.trim();
      }

      const res = await fetch(
        `${baseUrl.replace(/\/$/, "")}/api/v3/products/ai/menu/${businessId.trim()}`,
        {
          method: "POST",
          headers,
          body: buffer,
        }
      );

      const json = await res.json();

      if (!res.ok) {
        const errors = json.errors?.join(", ") ?? json.message ?? "Unknown error";
        setState({ status: "error", message: `${res.status}: ${errors}` });
        return;
      }

      const jobId: string = json.data?.jobId;
      if (!jobId) {
        setState({ status: "error", message: "No jobId returned from server" });
        return;
      }

      setState({ status: "polling", jobId });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  const isValid = file && businessId.trim();
  const isBusy = state.status === "loading" || state.status === "polling";

  return (
    <div className="container">
      <header>
        <h1>AI Menu Upload</h1>
        <p>Upload a menu image to extract structured data</p>
      </header>

      <form onSubmit={handleSubmit}>
        <section className="card">
          <h2>Endpoint</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="baseUrl">Base URL</label>
              <input
                id="baseUrl"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.localhost"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="businessId">Business ID</label>
              <input
                id="businessId"
                type="text"
                value={businessId}
                onChange={(e) => setBusinessId(e.target.value)}
                placeholder="UUID"
                required
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="token">Bearer Token <span className="optional">(optional)</span></label>
            <input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="your-auth-token"
            />
          </div>
          <div className="url-preview">
            <span className="method">POST</span>
            <span className="url">
              {baseUrl.replace(/\/$/, "")}/api/v3/products/ai/menu/
              <strong>{businessId.trim() || ":businessId"}</strong>
            </span>
          </div>
        </section>

        <section className="card">
          <h2>Image</h2>
          <div
            className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {preview ? (
              <div className="preview-container">
                <img src={preview} alt="Preview" className="preview" />
                <div className="file-info">
                  <span>{file?.name}</span>
                  <span className="size">{(file!.size / 1024).toFixed(1)} KB · {file?.type}</span>
                </div>
              </div>
            ) : (
              <div className="dropzone-hint">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <p>Drop an image here or click to browse</p>
                <span>PNG, JPG, WEBP, etc.</span>
              </div>
            )}
          </div>
        </section>

        <button
          type="submit"
          className="submit-btn"
          disabled={!isValid || isBusy}
        >
          {state.status === "loading" && <><span className="spinner" /> Uploading…</>}
          {state.status === "polling" && <><span className="spinner" /> Processing job {state.jobId.slice(0, 8)}…</>}
          {!isBusy && "Upload & Analyze"}
        </button>
      </form>

      {state.status === "error" && (
        <div className="result error">
          <strong>Error</strong>
          <p>{state.message}</p>
        </div>
      )}

      {state.status === "success" && (
        <div className="result success">
          <div className="result-header">
            <strong>Response</strong>
            <button
              className="copy-btn"
              onClick={() => navigator.clipboard.writeText(JSON.stringify(state.data, null, 2))}
            >
              Copy JSON
            </button>
          </div>
          <JsonHighlight data={state.data} />
        </div>
      )}
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
