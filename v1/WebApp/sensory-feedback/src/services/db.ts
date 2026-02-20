import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface Recording {
  id?: number;
  date: string;       // ISO string
  duration: number;   // seconds
  data: string;       // CSV string
  notes?: string;
}

interface WalkingDB extends DBSchema {
  recordings: {
    key: number;
    value: Recording;
    indexes: { 'by-date': string };
  };
}

const DB_NAME = 'walking-sensors-db';
const STORE_NAME = 'recordings';

let dbPromise: Promise<IDBPDatabase<WalkingDB>>;

export const getDB = () => {
    if (!dbPromise) {
        dbPromise = openDB<WalkingDB>(DB_NAME, 1, {
            upgrade(db) {
                const store = db.createObjectStore(STORE_NAME, {
                    keyPath: 'id',
                    autoIncrement: true,
                });
                store.createIndex('by-date', 'date');
            },
        });
    }
    return dbPromise;
};

export const saveRecording = async (duration: number, data: string, notes: string = '') => {
    const db = await getDB();
    const date = new Date().toISOString();
    return db.add(STORE_NAME, {
        date,
        duration,
        data,
        notes
    });
};

export const getAllRecordings = async () => {
    const db = await getDB();
    return db.getAllFromIndex(STORE_NAME, 'by-date');
};

export const deleteRecording = async (id: number) => {
    const db = await getDB();
    return db.delete(STORE_NAME, id);
};

export const updateRecordingNotes = async (id: number, notes: string) => {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    const record = await store.get(id);
    if (record) {
        record.notes = notes;
        await store.put(record);
    }
    await tx.done;
};
