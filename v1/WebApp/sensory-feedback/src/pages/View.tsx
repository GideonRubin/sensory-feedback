import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllRecordings, deleteRecording, updateRecordingNotes } from '@/services/db';
import { ArrowLeft, Download, Trash2, FileText } from 'lucide-react';

interface RecordingItem {
    id?: number;
    date: string;
    duration: number;
    data: string;
    notes?: string;
}

export function View() {
    const navigate = useNavigate();
    const [recordings, setRecordings] = useState<RecordingItem[]>([]);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editNote, setEditNote] = useState('');

    useEffect(() => {
        loadRecordings();
    }, []);

    const loadRecordings = async () => {
        const data = await getAllRecordings();
        // Sort by date descending (newest first)
        setRecordings(data.reverse());
    };

    const handleDownload = (rec: RecordingItem) => {
        const blob = new Blob([rec.data], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recording_${new Date(rec.date).toISOString()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleDelete = async (id: number) => {
        if(confirm('Are you sure you want to delete this recording?')) {
            await deleteRecording(id);
            loadRecordings();
        }
    };

    const startEdit = (rec: RecordingItem) => {
        setEditingId(rec.id!);
        setEditNote(rec.notes || '');
    };

    const saveNote = async (id: number) => {
        await updateRecordingNotes(id, editNote);
        setEditingId(null);
        loadRecordings();
    };

    return (
        <div className="min-h-screen bg-slate-50 p-4">
            <div className="mb-6">
                <h1 className="text-xl font-bold text-slate-800">Saved Sessions</h1>
            </div>

            <div className="space-y-3 max-w-md mx-auto">
                {recordings.length === 0 && (
                    <div className="text-center py-10 text-slate-400">
                        No recordings found.
                    </div>
                )}

                {recordings.map((rec) => (
                    <div key={rec.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <div className="text-sm font-semibold text-slate-800">
                                    {new Date(rec.date).toLocaleString()}
                                </div>
                                <div className="text-xs text-slate-500">
                                    Duration: {formatDuration(rec.duration)}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleDownload(rec)} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                                    <Download size={18} />
                                </button>
                                <button onClick={() => handleDelete(rec.id!)} className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Notes Section */}
                        <div className="pt-2 border-t border-slate-100 mt-2">
                            {editingId === rec.id ? (
                                <div className="flex gap-2">
                                    <input 
                                        className="flex-1 text-sm border border-slate-300 rounded px-2 py-1"
                                        value={editNote}
                                        onChange={(e) => setEditNote(e.target.value)}
                                        placeholder="Add a note..."
                                        autoFocus
                                    />
                                    <button onClick={() => saveNote(rec.id!)} className="text-xs bg-blue-500 text-white px-3 rounded">Save</button>
                                </div>
                            ) : (
                                <div 
                                    onClick={() => startEdit(rec)}
                                    className="text-xs text-slate-600 min-h-[20px] cursor-pointer hover:bg-slate-50 rounded px-1 -ml-1 flex items-center gap-2"
                                >
                                    <FileText size={12} className="text-slate-400" />
                                    {rec.notes || <span className="text-slate-400 italic">Add notes...</span>}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function formatDuration(seconds: number) {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
}
