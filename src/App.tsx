import React, { useState, useRef, useEffect } from 'react';
import { DownloadCloud, Play, CheckCircle, XCircle, Copy, Save, Loader2, AlertCircle, Github, ExternalLink, RefreshCw } from 'lucide-react';
import type { TrackerResult } from './types';

export default function App() {
  const [fetchUrl, setFetchUrl] = useState('https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all.txt');
  const [trackerText, setTrackerText] = useState('');
  
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  
  const [results, setResults] = useState<TrackerResult[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  
  const [showGithubInput, setShowGithubInput] = useState(false);
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem('githubToken') || '');
  const [isUploadingGist, setIsUploadingGist] = useState(false);
  const [gistUrl, setGistUrl] = useState('');

  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('githubToken', githubToken);
  }, [githubToken]);

  const handleFetchUrl = async (): Promise<string | null> => {
    if (!fetchUrl.trim()) return null;
    setIsFetchingUrl(true);
    try {
      const res = await fetch(`/api/fetch-url?url=${encodeURIComponent(fetchUrl)}`);
      if (!res.ok) throw new Error('Failed to fetch URL');
      const data = await res.json();
      const newText = trackerText + (trackerText ? '\n\n' : '') + data.text;
      setTrackerText(newText);
      return newText;
    } catch (err: any) {
      alert(`Error fetching URL: ${err.message}`);
      return null;
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const extractTrackers = (text: string) => {
    return Array.from(new Set(
      text.split('\n')
        .map(t => t.trim())
        .filter(t => {
          if (!t) return false;
          try {
            const url = new URL(t);
            return ['udp:', 'http:', 'https:', 'ws:', 'wss:'].includes(url.protocol);
          } catch {
            return false;
          }
        })
    ));
  };

  const executeCheck = async (trackers: string[]): Promise<TrackerResult[]> => {
    setIsChecking(true);
    setResults([]);
    setProgress({ current: 0, total: trackers.length });
    const finalResults: TrackerResult[] = [];
    
    try {
      const response = await fetch('/api/check-trackers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackers })
      });
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (line.trim()) {
              const data = JSON.parse(line) as TrackerResult;
              finalResults.push(data);
              setResults(prev => [...prev, data]);
              setProgress(prev => ({ ...prev, current: prev.current + 1 }));
            }
          }
        }
      }
    } catch (err: any) {
      alert(`Error checking trackers: ${err.message}`);
    } finally {
      setIsChecking(false);
    }
    return finalResults;
  };

  const handleCheckTrackers = async () => {
    const trackers = extractTrackers(trackerText);
    if (trackers.length === 0) {
      alert('No valid trackers found to check.');
      return;
    }
    await executeCheck(trackers);
  };

  const aliveTrackers = results.filter(r => r.isAlive).map(r => r.tracker).join('\n\n');
  const aliveCount = results.filter(r => r.isAlive).length;
  const deadCount = results.filter(r => !r.isAlive).length;

  const handleCopy = () => {
    if (!aliveTrackers) return;
    navigator.clipboard.writeText(aliveTrackers);
    alert('Copied to clipboard!');
  };

  const handleSave = () => {
    if (!aliveTrackers) return;
    const blob = new Blob([aliveTrackers], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'alive_trackers.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const uploadToGist = async (content: string) => {
    if (!githubToken.trim()) {
      alert('Please enter a GitHub Personal Access Token (requires gist scope).');
      setShowGithubInput(true);
      return null;
    }
    setIsUploadingGist(true);
    setGistUrl('');
    try {
      const res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${githubToken.trim()}`,
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
          description: 'Alive Torrent Trackers via Tracker Aggregator',
          public: false,
          files: {
            'alive_trackers.txt': {
              content
            }
          }
        })
      });
      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.statusText}`);
      }
      const data = await res.json();
      setGistUrl(data.html_url);
      return data.html_url;
    } catch (e: any) {
      alert(`Error creating Gist: ${e.message}`);
      return null;
    } finally {
      setIsUploadingGist(false);
    }
  };

  const handleCreateGist = () => uploadToGist(aliveTrackers);

  const handleAutoSync = async () => {
    if (!githubToken.trim()) {
      alert('Please configure your GitHub token first to use Auto-Sync.');
      setShowGithubInput(true);
      return;
    }
    setIsAutoSyncing(true);
    try {
      const fetchedText = await handleFetchUrl();
      if (!fetchedText) throw new Error('Fetch failed');
      
      const trackers = extractTrackers(fetchedText);
      const checkedResults = await executeCheck(trackers);
      
      const aliveList = checkedResults.filter(r => r.isAlive).map(r => r.tracker).join('\n\n');
      if (aliveList) {
         await uploadToGist(aliveList);
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setIsAutoSyncing(false);
    }
  };

  useEffect(() => {
    if (resultsRef.current && isChecking) {
      resultsRef.current.scrollTop = resultsRef.current.scrollHeight;
    }
  }, [results, isChecking]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Torrent Tracker Aggregator</h1>
          </div>
          <button
            onClick={handleAutoSync}
            disabled={isAutoSyncing || isChecking || isFetchingUrl}
            className="px-5 py-2.5 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 transition flex items-center shadow-sm disabled:opacity-50"
          >
            {isAutoSyncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            {isAutoSyncing ? 'Running Pipeline...' : 'Auto Sync to Gist'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Input */}
          <div className="space-y-6">
            
            {/* Fetch from URL */}
            <div className="bg-white rounded-xl shadow-sm border border-neutral-200 p-6 space-y-4">
              <h2 className="text-lg font-semibold text-neutral-800">1. Extract from URL</h2>
              <div className="flex space-x-2">
                <input 
                  type="text" 
                  value={fetchUrl}
                  onChange={e => setFetchUrl(e.target.value)}
                  className="flex-1 px-4 py-2 bg-neutral-50 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                  placeholder="https://..."
                />
                <button 
                  onClick={handleFetchUrl}
                  disabled={isFetchingUrl || isAutoSyncing}
                  className="px-4 py-2 bg-neutral-100 text-neutral-800 border border-neutral-200 rounded-lg hover:bg-neutral-200 transition flex items-center justify-center disabled:opacity-50"
                >
                  {isFetchingUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4 mr-2" />}
                  {isFetchingUrl ? '' : 'Fetch'}
                </button>
              </div>
            </div>

            {/* Manual Input */}
            <div className="bg-white rounded-xl shadow-sm border border-neutral-200 p-6 space-y-4 flex flex-col h-[320px]">
              <div className="flex justify-between items-end">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-800">2. Raw Tracker List</h2>
                </div>
                <div className="text-xs text-neutral-400 font-medium">
                  {extractTrackers(trackerText).length} unique parsed
                </div>
              </div>
              <textarea
                value={trackerText}
                onChange={e => setTrackerText(e.target.value)}
                className="flex-1 w-full p-4 bg-neutral-50 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition resize-none font-mono text-sm whitespace-pre"
                placeholder="udp://tracker.opentrackr.org:1337/announce&#10;http://tracker.openbittorrent.com:80/announce"
              />
              <button 
                onClick={handleCheckTrackers}
                disabled={isChecking || !trackerText.trim() || isAutoSyncing}
                className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center justify-center font-medium disabled:opacity-50"
              >
                {isChecking ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Checking... ({progress.current}/{progress.total})
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 mr-2" />
                    Verify Connectivity
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Output */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-neutral-200 p-6 space-y-4 flex flex-col h-[320px]">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-800">3. Alive Trackers</h2>
                </div>
                {results.length > 0 && (
                  <div className="flex items-center space-x-3 text-sm">
                    <span className="flex items-center text-emerald-600 font-medium">
                      <CheckCircle className="w-4 h-4 mr-1" /> {aliveCount}
                    </span>
                    <span className="flex items-center text-rose-600 font-medium">
                      <XCircle className="w-4 h-4 mr-1" /> {deadCount}
                    </span>
                  </div>
                )}
              </div>

              {/* Console Output */}
              <div 
                ref={resultsRef}
                className="flex-1 bg-neutral-900 rounded-lg p-4 overflow-y-auto font-mono text-xs space-y-1"
              >
                {results.length === 0 && !isChecking && (
                  <div className="h-full flex items-center justify-center text-neutral-600 flex-col">
                    <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
                    <p>Run the verifier to see results.</p>
                  </div>
                )}
                {results.filter(r => r.isAlive).map((r, i) => (
                  <div key={i} className="flex items-start">
                    <span className="w-16 flex-shrink-0 text-emerald-400">
                      [ALIVE]
                    </span>
                    <span className="text-neutral-300 break-all">{r.tracker}</span>
                  </div>
                ))}
                {isChecking && (
                  <div className="flex items-center text-blue-400 mt-2">
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    Checking remaining trackers...
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex space-x-3 pt-2">
                <button 
                  onClick={handleCopy}
                  disabled={aliveCount === 0}
                  className="flex-1 py-2.5 bg-neutral-100 text-neutral-700 rounded-lg hover:bg-neutral-200 transition flex items-center justify-center font-medium disabled:opacity-50"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Text
                </button>
                <button 
                  onClick={handleSave}
                  disabled={aliveCount === 0}
                  className="flex-1 py-2.5 bg-neutral-100 text-neutral-700 rounded-lg hover:bg-neutral-200 transition flex items-center justify-center font-medium disabled:opacity-50"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save .txt
                </button>
                <button 
                  onClick={() => setShowGithubInput(!showGithubInput)}
                  className={`flex-1 py-2.5 rounded-lg transition flex items-center justify-center font-medium ${showGithubInput || githubToken ? 'bg-neutral-900 text-white hover:bg-neutral-800' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                >
                  <Github className="w-4 h-4 mr-2" />
                  Gist Settings
                </button>
              </div>
              
              {/* GitHub Gist Panel */}
              {showGithubInput && (
                <div className="pt-4 border-t border-neutral-100 space-y-3">
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-neutral-500 font-medium">GitHub Personal Access Token</p>
                    {githubToken && <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">Saved locally</span>}
                  </div>
                  <div className="flex space-x-2">
                    <input 
                      type="password" 
                      value={githubToken}
                      onChange={e => setGithubToken(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxx..."
                      className="flex-1 px-3 py-2 text-sm bg-neutral-50 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-400"
                    />
                    <button 
                      onClick={handleCreateGist}
                      disabled={isUploadingGist || !githubToken || aliveCount === 0}
                      className="px-4 py-2 bg-neutral-900 text-white text-sm rounded-lg hover:bg-neutral-800 transition flex items-center disabled:opacity-50"
                    >
                      {isUploadingGist ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Push Now'}
                    </button>
                  </div>
                  {gistUrl && (
                    <a href={gistUrl} target="_blank" rel="noopener noreferrer" className="flex items-center text-sm text-blue-600 hover:underline">
                      <ExternalLink className="w-3 h-3 mr-1" />
                      View uploaded Gist
                    </a>
                  )}
                  <p className="text-[10px] text-neutral-400">Needs a token with 'gist' scope. Token is saved in your browser's local storage and never sent to our server.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

