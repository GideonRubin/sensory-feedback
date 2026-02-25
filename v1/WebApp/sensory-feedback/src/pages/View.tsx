import { useEffect, useState } from 'react';
import { getAllRecordings, deleteRecording, updateRecordingNotes, downloadRecordingData, type CloudRecording } from '@/services/blobService';
import { Download, Trash2, FileText, Play, Loader2 } from 'lucide-react';
import { PlaybackModal } from '@/components/PlaybackModal';

export function View() {
    const [recordings, setRecordings] = useState<CloudRecording[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingUrl, setEditingUrl] = useState<string | null>(null);
    const [editNote, setEditNote] = useState('');
    
    // Playback State
    const [playbackRec, setPlaybackRec] = useState<{ date: string; data: string } | null>(null);
    const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);

    useEffect(() => {
        loadRecordings();
    }, []);

    const loadRecordings = async () => {
        setLoading(true);
        try {
            const data = await getAllRecordings();
            setRecordings(data);
        } catch (err) {
            console.error('Failed to load recordings:', err);
        } finally {
            setLoading(false);
        }
    };

    const handlePlayback = async (rec: CloudRecording) => {
        setDownloadingUrl(rec.url);
        try {
            const csvData = await downloadRecordingData(rec.url);
            setPlaybackRec({ date: rec.date, data: csvData });
        } catch (err) {
            console.error('Failed to download recording:', err);
            alert('Failed to load recording for playback');
        } finally {
            setDownloadingUrl(null);
        }
    };

    const handleDownload = async (rec: CloudRecording) => {
        try {
            const csvData = await downloadRecordingData(rec.url);
            const blob = new Blob([csvData], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `recording_${new Date(rec.date).toISOString()}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Download failed:', err);
            alert('Failed to download recording');
        }
    };

    const handleDelete = async (blobUrl: string) => {
        if(confirm('Are you sure you want to delete this recording?')) {
            await deleteRecording(blobUrl);
            loadRecordings();
        }
    };

    const startEdit = (rec: CloudRecording) => {
        setEditingUrl(rec.url);
        setEditNote(rec.notes || '');
    };

    const saveNote = async (blobUrl: string) => {
        await updateRecordingNotes(blobUrl, editNote);
        setEditingUrl(null);
        loadRecordings();
    };

    return (
        <div className="relative flex flex-col w-full h-[100dvh] bg-slate-50 text-slate-900 overflow-hidden">
            {/* Background Decor */}
            <div className="absolute top-0 left-0 w-full h-[50vh] bg-gradient-to-b from-slate-200/50 to-transparent -z-10" />

            <div className="flex-none pt-12 px-6 pb-6 text-left relative z-10">
                <h1 className="text-3xl font-bold text-slate-800 tracking-tight mb-1">Saved Sessions</h1>
                <p className="text-sm font-medium text-slate-400 uppercase tracking-widest">{recordings.length} Recordings</p>
            </div>

            <div className="flex-1 w-full max-w-md mx-auto px-4 overflow-y-auto no-scrollbar pb-24 space-y-3">
                {loading && (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
                        <Loader2 size={32} className="animate-spin opacity-40" />
                        <span className="text-sm font-medium">Loading from cloud...</span>
                    </div>
                )}

                {!loading && recordings.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
                        <FileText size={48} className="opacity-20" />
                        <span className="text-sm font-medium">No recordings found</span>
                    </div>
                )}

                {recordings.map((rec, index) => (
                    <div key={rec.url} className="group relative bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] transition-all duration-300 border border-slate-100/50 hover:border-blue-500/20 active:scale-[0.99]">
                        <div className="flex justify-between items-start mb-4">
                            <div 
                                className="cursor-pointer flex-1"
                                onClick={() => handlePlayback(rec)} 
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-blue-50 group-hover:bg-blue-600 transition-colors duration-300 flex items-center justify-center text-blue-600 group-hover:text-white shadow-sm group-hover:shadow-blue-500/30">
                                       {downloadingUrl === rec.url ? (
                                           <Loader2 size={20} className="animate-spin" />
                                       ) : (
                                           <Play size={20} fill="currentColor" className="ml-0.5 transition-transform group-hover:scale-110" />
                                       )}
                                    </div>
                                    <div className="text-left py-0.5">
                                        <div className="text-lg font-bold text-slate-800 leading-none mb-1.5 group-hover:text-blue-600 transition-colors">
                                            {index + 1}
                                        </div>
                                        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                                            <span>{new Date(rec.date || rec.uploadedAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: 'numeric' })}</span>
                                            <span className="w-0.5 h-0.5 rounded-full bg-slate-300" />
                                            <span>{new Date(rec.date || rec.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            <span className="w-0.5 h-0.5 rounded-full bg-slate-300" />
                                            <span className="text-slate-500">{formatDuration(rec.duration)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex gap-1 shrink-0 ml-2">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleDownload(rec); }} 
                                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                    title="Download CSV"
                                >
                                    <Download size={18} />
                                </button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleDelete(rec.url); }}
                                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Delete"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Notes Section */}
                        <div className="pl-[52px]">
                            {editingUrl === rec.url ? (
                                <div className="flex gap-2">
                                    <input 
                                        className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                        value={editNote}
                                        onChange={(e) => setEditNote(e.target.value)}
                                        placeholder="Add a note..."
                                        autoFocus
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); saveNote(rec.url); }}
                                        className="text-xs bg-slate-900 text-white px-3 rounded-lg font-medium hover:bg-slate-800 transition-colors"
                                    >
                                        Save
                                    </button>
                                </div>
                            ) : (
                                <div 
                                    onClick={(e) => { e.stopPropagation(); startEdit(rec); }}
                                    className="text-xs text-slate-500 cursor-pointer hover:text-slate-700 transition-colors flex items-center gap-1.5"
                                >
                                    {rec.notes ? (
                                        <>
                                            <FileText size={12} className="text-slate-400" />
                                            <span>{rec.notes}</span>
                                        </>
                                    ) : (
                                        <span className="text-slate-300 italic text-[11px] group-hover:text-slate-400 transition-colors">Add notes...</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Playback Modal */}
            {playbackRec && (
                <PlaybackModal 
                    isOpen={!!playbackRec} 
                    onClose={() => setPlaybackRec(null)} 
                    recording={playbackRec} 
                />
            )}
        </div>
    );
}

function formatDuration(seconds: number) {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
}
