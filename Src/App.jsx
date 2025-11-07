import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, query, onSnapshot, getDoc, where, orderBy, updateDoc, writeBatch } from 'firebase/firestore';
import { Activity, Clock, Award, Users, GitCommit, Zap, Shield, Heart, Feather, BookOpen, MessageSquare, Target, User, TrendingUp, BarChart, X, Check, Search, Trash2, ZapOff } from 'lucide-react';

// --- CONFIGURATION CONSTANTS (DO NOT CHANGE) ---
const NINE_NOBLE_VIRTUES = [
  'Truth', 'Honor', 'Fidelity', 'Discipline', 'Hospitality',
  'Industriousness', 'Self-Reliance', 'Perseverance', 'Courage'
];

// NNV Category Weighting as per IFS Protocol
const WEIGHTS = {
  internal: 0.40, // Category I: Internal Fortitude
  external: 0.40, // Category II: External Accountability
  highStakes: 0.20 // Category III: High-Stakes Integrity (SCI Mandate)
};

// IFS Trigger Thresholds
const TRIGGERS = {
  VC_WARNING_DAYS: 3, // Consecutive days below 75%
  RJB_MANDATE_DAYS: 5, // Total days below 50% in 30 days
  GRADUATION_DAYS: 180, // Consecutive days above 90%
  VC_SCORE_THRESHOLD: 75,
  RJB_SCORE_THRESHOLD: 50,
  GRADUATION_SCORE_THRESHOLD: 90,
};

// Foundational Mandates for the Ethos Tab
const FOUNDATIONAL_MANDATES = [
  { 
    title: 'Zero Client Fee Mandate', 
    description: 'Clients pay zero fees for the TRU program. All operational costs are covered by the Trades Guild Enterprise surplus.',
    icon: <ZapOff size={20} className="text-lime-500" />
  },
  { 
    title: 'Mandate of Radical Transparency', 
    description: 'All IFS scores, protocols, and operational procedures are public and available to clients, staff, and the community.',
    icon: <Search size={20} className="text-lime-500" />
  },
  { 
    title: 'Equanimity Wage Mandate (EWM)', 
    description: 'Staff compensation is tied directly to the collective success (IFS average) of the client cohort, ensuring alignment.',
    icon: <BarChart size={20} className="text-lime-500" />
  },
  { 
    title: 'Synthetic Compound Integrity (SCI) Mandate', 
    description: 'TRU enforces a strict chemically manufactured substances free policy. Adherence is non-negotiable and measured in the High-Stakes Integrity category (20% IFS).',
    icon: <Shield size={20} className="text-lime-500" />
  },
];

// --- FIREBASE AND INITIALIZATION ---
let db, auth;
let appId = 'default-app-id';

// Initialize Firebase using global environment variables
try {
    const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
    appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    
    if (Object.keys(firebaseConfig).length > 0) {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        // setLogLevel('debug'); // Uncomment for debugging
    }
} catch (e) {
    console.error("Firebase initialization failed:", e);
}


// --- UTILITY FUNCTIONS ---

// Converts base64 audio data to a playable audio URL
const playBase64Audio = (base64Data, sampleRate) => {
    if (!base64Data) return;

    // Helper to convert base64 to ArrayBuffer
    const base64ToArrayBuffer = (base64) => {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    };

    // Helper to create a WAV Blob header
    const pcmToWav = (pcm16, sampleRate) => {
        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
        const blockAlign = numChannels * (bitsPerSample / 8);
        const dataSize = pcm16.length * 2; // 2 bytes per sample for 16-bit PCM

        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        // RIFF chunk
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(view, 8, 'WAVE');

        // FMT chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM format (1)
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);

        // DATA chunk
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // Write PCM data
        let offset = 44;
        for (let i = 0; i < pcm16.length; i++, offset += 2) {
            view.setInt16(offset, pcm16[i], true);
        }

        return new Blob([view], { type: 'audio/wav' });
    };

    const writeString = (view, offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    try {
        const pcmData = base64ToArrayBuffer(base64Data);
        // API returns signed PCM16 audio data.
        const pcm16 = new Int16Array(pcmData);
        const wavBlob = pcmToWav(pcm16, sampleRate);
        const audioUrl = URL.createObjectURL(wavBlob);
        
        const audio = new Audio(audioUrl);
        audio.play().catch(e => console.error("Error playing audio:", e));
    } catch (e) {
        console.error("Error processing audio:", e);
    }
};

const getUserId = (user) => user?.uid || 'anonymous';
const todayDate = new Date().toISOString().split('T')[0];

const buildClientList = (scores) => {
    // Simple mock clients if no data exists, for demonstration
    if (!scores || scores.length === 0) {
        return [{ id: 'mock-client-1', name: 'Alumnus - J. Doe', phase: 'IV. Covenant House' }];
    }
    
    // Extract unique client IDs from the score history
    const clientMap = new Map();
    scores.forEach(score => {
        if (score.targetUserId && !clientMap.has(score.targetUserId)) {
            // Mocking client details based on ID structure for demo, in a real app this comes from a dedicated 'clients' collection
            const name = score.targetUserId.length > 10 
                ? `Client ${score.targetUserId.substring(0, 4)}` 
                : score.targetUserId;
            clientMap.set(score.targetUserId, { 
                id: score.targetUserId, 
                name: name,
                phase: 'II. Foundation', // Default mock phase
                vocationalTrack: 'Trades Guild - Diesel' // Default mock track
            });
        }
    });
    
    // Ensure the current user is always an option for testing
    if (auth?.currentUser && !clientMap.has(auth.currentUser.uid)) {
        clientMap.set(auth.currentUser.uid, {
            id: auth.currentUser.uid, 
            name: `(Current User) ${auth.currentUser.uid.substring(0, 8)}`,
            phase: 'I.A. The Forge',
            vocationalTrack: 'Orientation'
        });
    }

    return Array.from(clientMap.values());
};

const calculateIFS = (scores) => {
    const internal = scores.internal || 0;
    const external = scores.external || 0;
    const highStakes = scores.highStakes || 0;

    // IFS = (NNV I * 40%) + (NNV II * 40%) + (NNV III * 20%)
    return Math.round(
        (internal * WEIGHTS.internal) +
        (external * WEIGHTS.external) +
        (highStakes * WEIGHTS.highStakes)
    );
};

const calculateTriggers = (scoreHistory) => {
    if (!scoreHistory || scoreHistory.length === 0) {
        return { vcWarning: 0, rjbDays: 0, gradDays: 0, latestIFS: 0 };
    }

    // Sort the scores by date descending
    const sortedScores = [...scoreHistory].sort((a, b) => b.date.localeCompare(a.date));

    const latestIFS = sortedScores[0].finalIFS;
    let vcWarningDays = 0;
    let gradDays = 0;
    let rjbDays = 0;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Calculate consecutive days for VC/Graduation
    for (let i = 0; i < sortedScores.length; i++) {
        const score = sortedScores[i];
        
        // 1. Graduation Days (Consecutive days >= 90%)
        if (score.finalIFS >= TRIGGERS.GRADUATION_SCORE_THRESHOLD) {
            gradDays = i + 1;
        } else {
            // Once the streak breaks, stop counting.
            break;
        }
    }
    
    // Calculate VC Warning Days (Consecutive days < 75%)
    for (let i = 0; i < sortedScores.length; i++) {
        const score = sortedScores[i];
        
        // Check for continuity based on date
        const currentDate = new Date(score.date);
        const previousDate = new Date(sortedScores[i - 1]?.date || '1970-01-01');
        
        // Only count consecutive days. If there's a gap, break or reset.
        if (i > 0 && (currentDate.getTime() !== previousDate.getTime() - (24 * 60 * 60 * 1000))) {
            // If the dates are not consecutive, we stop counting
            break; 
        }

        if (score.finalIFS < TRIGGERS.VC_SCORE_THRESHOLD) {
            vcWarningDays = i + 1;
        } else {
            // Once the streak breaks, stop counting.
            break;
        }
    }

    // Calculate RJB Days (Total days < 50% in the last 30 calendar days)
    rjbDays = scoreHistory.filter(score => {
        const scoreDate = new Date(score.date);
        return scoreDate >= thirtyDaysAgo && score.finalIFS < TRIGGERS.RJB_SCORE_THRESHOLD;
    }).length;


    return {
        vcWarning: vcWarningDays,
        rjbDays: rjbDays,
        gradDays: gradDays,
        latestIFS: latestIFS,
    };
};

// --- API FETCHERS (LLM & TTS) ---

const fetchGeminiResponse = async (prompt, systemInstruction) => {
    const apiKey = "";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
    };

    const MAX_RETRIES = 3;
    let delay = 1000;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const result = await response.json();
            const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            return text || "Error: Could not generate response.";

        } catch (error) {
            if (attempt === MAX_RETRIES - 1) {
                console.error("Gemini API failed after multiple retries:", error);
                return "Error: Failed to generate response after multiple attempts.";
            }
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
    return "Error: Failed to generate response.";
};

const fetchTTSAudio = async (text, setAudioUrl, setLoading) => {
    setLoading(true);
    setAudioUrl(null);
    const apiKey = ""; 
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

    const payload = {
        contents: [{
            parts: [{ text: `Say with a firm, encouraging tone: ${text}` }]
        }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: "Kore" } // Firm voice
                }
            }
        },
        model: "gemini-2.5-flash-preview-tts"
    };

    const MAX_RETRIES = 3;
    let delay = 1000;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const result = await response.json();
            const part = result?.candidates?.[0]?.content?.parts?.[0];
            const audioData = part?.inlineData?.data;
            const mimeType = part?.inlineData?.mimeType;

            if (audioData && mimeType && mimeType.startsWith("audio/L16")) {
                const sampleRateMatch = mimeType.match(/rate=(\d+)/);
                const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1], 10) : 16000;
                playBase64Audio(audioData, sampleRate);
            } else {
                console.error("TTS response missing audio data or invalid mimeType:", mimeType);
            }
            setLoading(false);
            return;

        } catch (error) {
            if (attempt === MAX_RETRIES - 1) {
                console.error("TTS API failed after multiple retries:", error);
            }
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
    setLoading(false);
};


// --- REACT COMPONENTS ---

// Logo SVG Component (Based on uploaded image)
const TRULogo = ({ className }) => (
    <svg 
        className={className} 
        viewBox="0 0 300 280" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
    >
        {/* Base Diamond Shape (Simplified for vector use) */}
        <path d="M150 0L300 140L150 280L0 140L150 0Z" fill="#1f2937" /> 
        
        {/* Main Mountain Range (Dark Gray/Black) */}
        <path d="M0 140L75 50L150 140L225 50L300 140V140H0Z" fill="#111827" />

        {/* Snow Peaks (White/Light Gray) */}
        <path d="M75 50L112.5 80L150 50L187.5 80L225 50V50L213 60L187.5 35L150 65L112.5 35L87 60L75 50Z" fill="#d1d5db" />
        
        {/* Neon Green Path */}
        <path d="M150 280C150 280 160 170 190 140C220 110 210 100 200 140C190 180 180 200 150 200C120 200 110 180 100 140C90 100 80 110 110 140C140 170 150 280 150 280Z" fill="#84cc16" opacity="0.4" />
        
        {/* Neon Green Peaks (Accent) */}
        <path d="M75 50L85 60L100 45L112.5 55L120 40L150 60L180 40L190 55L205 45L215 60L225 50L218 55L205 48L190 58L180 45L150 70L120 45L110 58L95 48L82 55L75 50Z" fill="#84cc16" />
        
        {/* TRU Text (Black with light gray shadow) - Simplified for vector */}
        <text x="150" y="200" textAnchor="middle" fontSize="110" fontWeight="bold" fill="#000000" style={{textShadow: "2px 2px #d1d5db"}}>
            TRU
        </text>
    </svg>
);


const IconButton = ({ children, onClick, className = '' }) => (
    <button
        onClick={onClick}
        className={`p-2 rounded-full shadow-lg transition-all duration-200 
                   bg-lime-500 hover:bg-lime-600 text-gray-900 focus:outline-none focus:ring-4 focus:ring-lime-500 focus:ring-opacity-50 ${className}`}
    >
        {children}
    </button>
);

const SectionTitle = ({ children, icon: Icon }) => (
    <h2 className="text-xl font-bold mb-4 flex items-center text-lime-400">
        <Icon className="mr-2" size={20} />
        {children}
    </h2>
);

const AppLoader = () => (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-900">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-lime-500"></div>
        <p className="mt-4 text-lime-400 font-semibold">Loading TRU Covenant Console...</p>
    </div>
);


const DailyFocus = ({ userId, audioLoading, fetchTTS, setAudioLoading }) => {
    const [selectedVirtue, setSelectedVirtue] = useState(NINE_NOBLE_VIRTUES[0]);
    const [implementationText, setImplementationText] = useState("Select a virtue to get your daily, actionable focus.");
    const [generating, setGenerating] = useState(false);

    const getVirtueDescription = useCallback(async (virtue) => {
        setGenerating(true);
        const systemPrompt = `You are a Stoic and vocational mentor for the "Two Ravens United" (TRU) program. Your task is to provide a single, actionable, immediately implementable interpretation of the provided virtue. The focus must be on practical work ethic, resilience, and personal integrity. Keep the response to 1-2 sentences.`;
        const userPrompt = `Give me a specific action for today based on the virtue: ${virtue}.`;
        
        const text = await fetchGeminiResponse(userPrompt, systemPrompt);
        setImplementationText(text);
        setGenerating(false);
    }, []);

    useEffect(() => {
        getVirtueDescription(selectedVirtue);
    }, [selectedVirtue, getVirtueDescription]);

    const handlePlay = () => {
        if (!generating && !audioLoading && implementationText) {
            fetchTTS(implementationText, setAudioLoading);
        }
    };

    return (
        <div className="p-4 space-y-4">
            <SectionTitle icon={BookOpen}>Daily Virtue Focus</SectionTitle>
            
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {NINE_NOBLE_VIRTUES.map(virtue => (
                    <button
                        key={virtue}
                        onClick={() => setSelectedVirtue(virtue)}
                        className={`text-xs sm:text-sm font-semibold p-2 rounded-lg transition-all duration-200 
                                    ${selectedVirtue === virtue 
                                        ? 'bg-lime-500 text-gray-900 shadow-md' 
                                        : 'bg-gray-800 text-lime-400 hover:bg-gray-700'}`}
                    >
                        {virtue}
                    </button>
                ))}
            </div>

            <div className="bg-gray-800 p-4 rounded-xl shadow-inner border border-gray-700">
                <h3 className="text-lg font-bold text-lime-300 mb-2">{selectedVirtue} - The Daily Directive</h3>
                <p className="text-gray-200 italic min-h-[4rem]">
                    {generating ? (
                        <span className="flex items-center">
                            <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-lime-500 mr-2"></span>
                            Generating actionable focus...
                        </span>
                    ) : implementationText}
                </p>
                
                <div className="mt-4 pt-4 border-t border-gray-700 flex justify-end">
                    <button 
                        onClick={handlePlay} 
                        disabled={generating || audioLoading}
                        className={`px-4 py-2 rounded-full font-bold text-sm flex items-center transition-colors 
                                   ${(generating || audioLoading) ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-lime-500 hover:bg-lime-600 text-gray-900'}`}
                    >
                        {audioLoading ? (
                            <span className="flex items-center">
                                <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-gray-900 mr-2"></span>
                                Generating Audio...
                            </span>
                        ) : (
                            <span className="flex items-center">
                                <Heart size={18} className="mr-2" />
                                Listen: Fortress Forge Walkthrough
                            </span>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};


const DailyIFSLog = ({ userId, isAuthenticated, scoreHistory, crucibleHistory, clients }) => {
    const [scores, setScores] = useState({ internal: 0, external: 0, highStakes: 0 });
    const [targetUserId, setTargetUserId] = useState(userId);
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [step, setStep] = useState(1); // 1: IFS Input, 2: Daily Crucible
    const [crucible, setCrucible] = useState({ truth: false, fidelity: false, courage: false });
    const [isCrucibleComplete, setIsCrucibleComplete] = useState(false); // Flag to check if today's crucible is done

    useEffect(() => {
        setTargetUserId(userId);
    }, [userId]);
    
    useEffect(() => {
        // Check if crucible is complete for today
        const todayCrucible = crucibleHistory.find(c => c.date === todayDate && c.userId === userId);
        setIsCrucibleComplete(!!todayCrucible);
        setStep(1); // Reset step when history updates
    }, [crucibleHistory, userId]);

    const handleIFSChange = (e) => {
        const { name, value } = e.target;
        // Clamp score between 0 and 100
        const score = Math.min(100, Math.max(0, parseInt(value, 10) || 0));
        setScores(prev => ({ ...prev, [name]: score }));
    };

    const handleIFSSubmit = async (e) => {
        e.preventDefault();
        if (!isAuthenticated || !targetUserId || submitting) return;
        setSubmitting(true);

        try {
            const finalIFS = calculateIFS(scores);
            const scoreDocRef = doc(db, `artifacts/${appId}/public/data/ifs_daily_scores`, `${targetUserId}-${todayDate}`);

            await setDoc(scoreDocRef, {
                date: todayDate,
                targetUserId: targetUserId,
                recordedBy: userId,
                internal: scores.internal,
                external: scores.external,
                highStakes: scores.highStakes,
                finalIFS: finalIFS,
                note: note,
                timestamp: Date.now()
            }, { merge: true });

            setStep(2); // Move to Daily Crucible
            setNote('');
            setScores({ internal: 0, external: 0, highStakes: 0 });
        } catch (e) {
            console.error("Error adding IFS document:", e);
        } finally {
            setSubmitting(false);
        }
    };
    
    const handleCrucibleSubmit = async () => {
        if (!isAuthenticated || submitting || isCrucibleComplete) return;
        setSubmitting(true);

        try {
            const crucibleDocRef = doc(db, `artifacts/${appId}/users/${userId}/daily_checkins`, todayDate);

            await setDoc(crucibleDocRef, {
                date: todayDate,
                userId: userId,
                truth: crucible.truth,
                fidelity: crucible.fidelity,
                courage: crucible.courage,
                timestamp: Date.now()
            }, { merge: true });

            setIsCrucibleComplete(true);
            setStep(1); // Reset to step 1 for tomorrow
        } catch (e) {
            console.error("Error adding Crucible document:", e);
        } finally {
            setSubmitting(false);
        }
    };

    const clientOptions = useMemo(() => buildClientList(scoreHistory), [scoreHistory]);
    
    const renderStep1 = () => (
        <form onSubmit={handleIFSSubmit} className="space-y-4">
            <p className="text-lime-400 font-bold text-center border-b border-gray-700 pb-2">Step 1: Integrity & Functionality Score (IFS) Input</p>

            <div className="bg-gray-700 p-3 rounded-xl">
                <label className="block text-sm font-medium text-gray-300 mb-2">Target Client (Staff/VC Only)</label>
                <select
                    value={targetUserId}
                    onChange={(e) => setTargetUserId(e.target.value)}
                    className="w-full p-2 rounded-lg bg-gray-900 text-white border border-gray-600 focus:ring-lime-500 focus:border-lime-500"
                >
                    <option value={userId} className="font-bold">Self-Assessment (Current User)</option>
                    {clientOptions.map(client => (
                        <option key={client.id} value={client.id}>
                            {client.name} (ID: {client.id.substring(0, 8)})
                        </option>
                    ))}
                </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Object.entries({
                    internal: { label: 'Internal Fortitude (40%)', desc: 'Discipline, Perseverance, Self-Reliance' },
                    external: { label: 'External Accountability (40%)', desc: 'Hospitality, Industriousness, Fidelity' },
                    highStakes: { label: 'High-Stakes Integrity (20%)', desc: 'Truth, Honor, Synthetic Compound Integrity (SCI)' }
                }).map(([key, { label, desc }]) => (
                    <div key={key} className="bg-gray-800 p-3 rounded-lg border border-gray-700 shadow-md">
                        <label htmlFor={key} className="block text-sm font-bold text-lime-400">{label}</label>
                        <p className="text-xs text-gray-400 mb-2">{desc}</p>
                        <input
                            type="number"
                            id={key}
                            name={key}
                            min="0"
                            max="100"
                            value={scores[key]}
                            onChange={handleIFSChange}
                            required
                            className="w-full p-2 text-xl font-mono rounded-lg bg-gray-900 text-lime-500 border border-gray-600 focus:ring-lime-500 focus:border-lime-500"
                            placeholder="0-100"
                        />
                    </div>
                ))}
            </div>

            <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Brief observational note (Mandatory for scores < 75)"
                rows="2"
                className="w-full p-3 rounded-lg bg-gray-900 text-gray-100 border border-gray-700 focus:ring-lime-500 focus:border-lime-500"
            />
            
            <button
                type="submit"
                disabled={submitting || !isAuthenticated || (step === 2)}
                className={`w-full py-3 rounded-lg font-bold text-lg flex items-center justify-center transition-colors duration-200 
                            ${(submitting || !isAuthenticated || (step === 2)) ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-lime-500 hover:bg-lime-600 text-gray-900 shadow-xl'}`}
            >
                {submitting ? (
                    <span className="flex items-center">
                        <span className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-gray-900 mr-2"></span>
                        Logging IFS...
                    </span>
                ) : (
                    <span className="flex items-center">
                        <Target size={20} className="mr-2" />
                        Log IFS & Proceed to Crucible ({calculateIFS(scores)}%)
                    </span>
                )}
            </button>
        </form>
    );

    const renderStep2 = () => (
        <div className="space-y-6">
            <p className="text-lime-400 font-bold text-center border-b border-gray-700 pb-2">Step 2: The Daily Crucible</p>
            
            <div className="bg-gray-800 p-4 rounded-xl shadow-inner border border-gray-700">
                <h3 className="text-lg font-bold text-lime-300 mb-3 flex items-center"><Zap size={20} className="mr-2 text-red-500" /> Immediate Self-Confrontation</h3>
                <p className="text-gray-300 mb-4">Complete these three high-stakes binary check-ins. This step is mandatory and focuses on the integrity of your commitment.</p>

                {Object.entries({
                    truth: { question: 'Did you maintain absolute Truth in all high-stakes communications today (no omissions)?', icon: <Feather size={20} /> },
                    fidelity: { question: 'Did you adhere to the Fidelity of your financial or relational commitments today?', icon: <Heart size={20} /> },
                    courage: { question: 'Did you confront a difficult truth or challenge today, instead of avoiding it?', icon: <Shield size={20} /> }
                }).map(([key, { question, icon }]) => (
                    <div key={key} className="flex items-center justify-between py-2 border-b border-gray-700 last:border-b-0">
                        <div className="flex items-center text-gray-200">
                            {icon}
                            <span className="ml-3 text-sm">{question}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setCrucible(prev => ({ ...prev, [key]: !prev[key] }))}
                            className={`p-1.5 rounded-full transition-colors duration-200 
                                       ${crucible[key] ? 'bg-lime-500 text-gray-900' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                        >
                            {crucible[key] ? <Check size={20} /> : <X size={20} />}
                        </button>
                    </div>
                ))}
            </div>
            
            <button
                onClick={handleCrucibleSubmit}
                disabled={submitting || !isAuthenticated || isCrucibleComplete || !(crucible.truth && crucible.fidelity && crucible.courage)}
                className={`w-full py-3 rounded-lg font-bold text-lg flex items-center justify-center transition-colors duration-200 
                            ${(submitting || isCrucibleComplete || !(crucible.truth && crucible.fidelity && crucible.courage)) ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 text-white shadow-xl'}`}
            >
                {isCrucibleComplete ? (
                     <span className="flex items-center">
                        <Check size={20} className="mr-2" />
                        Crucible Complete for {todayDate}
                    </span>
                ) : submitting ? (
                    <span className="flex items-center">
                        <span className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></span>
                        Submitting Crucible...
                    </span>
                ) : (
                    <span className="flex items-center">
                        <GitCommit size={20} className="mr-2" />
                        Commit Daily Crucible (Final Step)
                    </span>
                )}
            </button>
            <p className="text-center text-sm text-gray-400 mt-2">Note: All three questions must be marked true to submit.</p>
        </div>
    );

    if (!isAuthenticated) {
        return <p className="text-center p-8 text-gray-400">Please wait for authentication to load the accountability dashboard.</p>;
    }

    if (isCrucibleComplete) {
        return (
             <div className="flex flex-col items-center justify-center p-8 text-center bg-gray-800 rounded-xl m-4 shadow-2xl border border-lime-500/50">
                <Check size={48} className="text-lime-500 mb-4 animate-pulse" />
                <h3 className="text-xl font-bold text-lime-400">Daily Commitment Complete!</h3>
                <p className="text-gray-300 mt-2">Your IFS Score and Daily Crucible for **{todayDate}** have been logged.</p>
                <p className="text-gray-400 text-sm mt-1">Check back tomorrow for your next focus.</p>
            </div>
        );
    }
    
    return (
        <div className="p-4">
            <h2 className="text-2xl font-bold text-lime-500 mb-6 border-b border-gray-700 pb-2">Daily Log: Integrity & Commitment</h2>
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
        </div>
    );
};


const DataAnalytics = ({ isAuthenticated, scoreHistory }) => {
    const allClientScores = useMemo(() => {
        const map = new Map();
        scoreHistory.forEach(score => {
            const id = score.targetUserId;
            if (!map.has(id)) {
                map.set(id, []);
            }
            map.get(id).push(score);
        });
        return map;
    }, [scoreHistory]);

    // For display, use the current user or the first client found
    const displayClientId = isAuthenticated && auth?.currentUser?.uid 
        ? auth.currentUser.uid 
        : Array.from(allClientScores.keys())[0];
        
    const displayScores = allClientScores.get(displayClientId) || [];
    const { vcWarning, rjbDays, gradDays, latestIFS } = calculateTriggers(displayScores);

    const clientName = displayClientId ? buildClientList(scoreHistory).find(c => c.id === displayClientId)?.name || displayClientId.substring(0, 8) : 'N/A';
    
    // Calculate 30-Day Average
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentScores = displayScores.filter(score => new Date(score.date) >= thirtyDaysAgo);
    const sumIFS = recentScores.reduce((sum, score) => sum + score.finalIFS, 0);
    const avgIFS = recentScores.length > 0 ? Math.round(sumIFS / recentScores.length) : 0;
    
    const complianceDays = recentScores.filter(score => score.finalIFS >= 75).length;
    const totalDays = recentScores.length;

    return (
        <div className="p-4 space-y-6">
            <SectionTitle icon={TrendingUp}>Accountability Analytics (ID: {clientName})</SectionTitle>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard title="Latest IFS" value={`${latestIFS}%`} color="lime" icon={<Activity size={24} />} />
                <StatCard title="30-Day Avg IFS" value={`${avgIFS}%`} color={avgIFS >= 75 ? "lime" : "red"} icon={<BarChart size={24} />} />
                <StatCard title="Compliance Days (>75%)" value={`${complianceDays} / ${totalDays}`} color={complianceDays > totalDays * 0.75 ? "lime" : "yellow"} icon={<Check size={24} />} />
                <StatCard title="Graduation Track" value={`${gradDays} / ${TRIGGERS.GRADUATION_DAYS} Days`} color={gradDays > 0 ? "blue" : "gray"} icon={<Award size={24} />} />
            </div>

            <div className="bg-gray-800 p-4 rounded-xl shadow-lg border border-gray-700">
                <h3 className="text-xl font-bold text-red-400 mb-3 flex items-center"><Zap size={20} className="mr-2" /> High-Stakes Accountability Triggers</h3>
                <div className="space-y-3">
                    <TriggerItem 
                        title="VC Sanction Warning" 
                        value={vcWarning} 
                        threshold={TRIGGERS.VC_WARNING_DAYS} 
                        unit="Consecutive Days"
                        description="Days below 75% IFS. Triggers formal intervention at 3 days."
                        isTriggered={vcWarning >= TRIGGERS.VC_WARNING_DAYS}
                    />
                    <TriggerItem 
                        title="RJB Review Mandate" 
                        value={rjbDays} 
                        threshold={TRIGGERS.RJB_MANDATE_DAYS} 
                        unit="Total 30-Day Failures"
                        description="Days below 50% IFS. Triggers Restorative Justice Board review at 5 days."
                        isTriggered={rjbDays >= TRIGGERS.RJB_MANDATE_DAYS}
                    />
                </div>
            </div>
            
            <ScoreHistoryTable history={displayScores} />
        </div>
    );
};

const StatCard = ({ title, value, color, icon }) => {
    const colorClass = {
        lime: "text-lime-500",
        red: "text-red-500",
        yellow: "text-yellow-500",
        blue: "text-blue-500",
        gray: "text-gray-400",
    }[color] || "text-gray-300";

    return (
        <div className="bg-gray-800 p-4 rounded-xl shadow-lg border border-gray-700 flex flex-col justify-between">
            <div className="flex justify-between items-start">
                <h3 className="text-sm font-semibold text-gray-400 uppercase">{title}</h3>
                <div className={`${colorClass}`}>{icon}</div>
            </div>
            <p className={`text-3xl font-extrabold mt-2 ${colorClass}`}>{value}</p>
        </div>
    );
};

const TriggerItem = ({ title, value, threshold, unit, description, isTriggered }) => (
    <div className={`p-3 rounded-lg flex justify-between items-center transition-all ${isTriggered ? 'bg-red-900/50 border border-red-500' : 'bg-gray-700 border border-gray-600'}`}>
        <div>
            <h4 className="font-bold text-gray-100">{title}</h4>
            <p className="text-xs text-gray-400">{description}</p>
        </div>
        <div className="text-right">
            <p className={`text-2xl font-extrabold ${isTriggered ? 'text-red-400 animate-pulse' : 'text-lime-500'}`}>{value}</p>
            <p className="text-xs text-gray-400">{unit} (Threshold: {threshold})</p>
        </div>
    </div>
);


const ScoreHistoryTable = ({ history }) => {
    const sortedHistory = [...history].sort((a, b) => b.date.localeCompare(a.date));
    return (
        <div className="overflow-x-auto bg-gray-800 rounded-xl shadow-lg border border-gray-700">
            <table className="min-w-full divide-y divide-gray-700">
                <thead>
                    <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">IFS</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider hidden sm:table-cell">NNV I (40%)</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider hidden sm:table-cell">NNV II (40%)</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider hidden sm:table-cell">NNV III (20%)</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                    {sortedHistory.slice(0, 15).map((score, index) => (
                        <tr key={index} className={score.finalIFS < 50 ? 'bg-red-900/20' : score.finalIFS < 75 ? 'bg-yellow-900/20' : ''}>
                            <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-200">{score.date}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm font-extrabold" style={{ color: score.finalIFS >= 90 ? '#84cc16' : score.finalIFS >= 75 ? '#facc15' : score.finalIFS >= 50 ? '#fb923c' : '#f87171' }}>
                                {score.finalIFS}%
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 hidden sm:table-cell">{score.internal}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 hidden sm:table-cell">{score.external}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300 hidden sm:table-cell">{score.highStakes}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-xs">
                                {score.finalIFS >= 90 && <span className="bg-lime-500/20 text-lime-400 p-1 rounded-md font-semibold">Grad Track</span>}
                                {score.finalIFS < 75 && score.finalIFS >= 50 && <span className="bg-yellow-500/20 text-yellow-400 p-1 rounded-md font-semibold">VC Warning</span>}
                                {score.finalIFS < 50 && <span className="bg-red-500/20 text-red-400 p-1 rounded-md font-semibold">RJB FAILURE</span>}
                                {score.finalIFS >= 75 && score.finalIFS < 90 && <span className="bg-gray-500/20 text-gray-400 p-1 rounded-md font-semibold">Compliance</span>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const EthosAndMandates = () => (
    <div className="p-4 space-y-6">
        <SectionTitle icon={BookOpen}>Foundational Ethos & Mandates</SectionTitle>

        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-xl space-y-4">
            <h3 className="text-xl font-bold text-lime-400 border-b border-gray-700 pb-2">The Four Foundational Mandates</h3>
            <p className="text-sm text-gray-300 italic">These principles are non-negotiable and govern all operations, staff incentives, and client accountability.</p>
            {FOUNDATIONAL_MANDATES.map((mandate, index) => (
                <div key={index} className="flex items-start space-x-3 py-2">
                    <div className="flex-shrink-0 mt-1">{mandate.icon}</div>
                    <div>
                        <h4 className="text-lg font-bold text-gray-100">{mandate.title}</h4>
                        <p className="text-sm text-gray-300">{mandate.description}</p>
                    </div>
                </div>
            ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-xl">
                <h3 className="text-xl font-bold text-lime-400 mb-3 flex items-center"><Users size={20} className="mr-2" /> Accountability Structures</h3>
                <ul className="text-gray-300 space-y-3 list-disc list-inside">
                    <li>**The Virtue Council (VC):** Peer-elected body responsible for minor sanctions and ethical guidance. Triggers: 3 consecutive days below 75% IFS.</li>
                    <li>**Restorative Justice Board (RJB):** Multi-stakeholder judicial body. Triggers: 5 total days below 50% IFS in 30 days or breach of SCI Mandate.</li>
                </ul>
            </div>
            <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-xl">
                <h3 className="text-xl font-bold text-lime-400 mb-3 flex items-center"><Clock size={20} className="mr-2" /> Phased Progression</h3>
                <ul className="text-gray-300 space-y-3 list-disc list-inside">
                    <li>**Phase I.A: The Forge:** Orientation & basic skill acquisition (IFS focus on Discipline).</li>
                    <li>**Phase II: Foundation:** Trades Guild training begins (IFS focus on Industriousness).</li>
                    <li>**Phase III: Trades Guild:** Full-time enterprise work & Asset Builder Account growth.</li>
                    <li>**Phase IV/V: Alumni:** Transitional housing and full self-reliance (Graduation goal: 180 consecutive days > 90% IFS).</li>
                </ul>
            </div>
        </div>
    </div>
);


const TrothHearth = ({ isAuthenticated, userId }) => {
    const [posts, setPosts] = useState([]);
    const [newPost, setNewPost] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!db) return;
        const q = query(collection(db, `artifacts/${appId}/public/data/hearth_posts`), orderBy("timestamp", "desc"));
        
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedPosts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setPosts(fetchedPosts);
        }, (error) => console.error("Error fetching hearth posts:", error));

        return () => unsubscribe();
    }, [isAuthenticated]);

    const handlePostSubmit = async (e) => {
        e.preventDefault();
        if (!isAuthenticated || !newPost.trim() || submitting) return;
        setSubmitting(true);

        try {
            const batch = writeBatch(db);
            const postRef = doc(collection(db, `artifacts/${appId}/public/data/hearth_posts`));
            
            batch.set(postRef, {
                userId: userId,
                content: newPost.trim(),
                timestamp: Date.now()
            });
            
            // Optional: You could track user post count here for analytics
            
            await batch.commit();

            setNewPost('');
        } catch (e) {
            console.error("Error adding post:", e);
        } finally {
            setSubmitting(false);
        }
    };
    
    // Simple display name mapping for anonymous/mock users
    const getDisplayName = (id) => {
        if (!id) return "System";
        if (id === userId) return "You (Staff/Client)";
        return `Client ID: ${id.substring(0, 8)}`;
    };

    return (
        <div className="p-4 space-y-4">
            <SectionTitle icon={MessageSquare}>The Troth Hearth (Community Board)</SectionTitle>

            {/* Post Input */}
            <form onSubmit={handlePostSubmit} className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-lg">
                <textarea
                    value={newPost}
                    onChange={(e) => setNewPost(e.target.value)}
                    placeholder="Share a word of encouragement, a lesson learned, or a request for support. (Build Troth!)"
                    rows="3"
                    className="w-full p-3 rounded-lg bg-gray-900 text-gray-100 border border-gray-700 focus:ring-lime-500 focus:border-lime-500 resize-none"
                    disabled={!isAuthenticated}
                />
                <button
                    type="submit"
                    disabled={!isAuthenticated || submitting || !newPost.trim()}
                    className={`mt-3 w-full py-2 rounded-lg font-bold transition-colors 
                                ${!isAuthenticated || submitting || !newPost.trim() ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-lime-500 hover:bg-lime-600 text-gray-900'}`}
                >
                    {submitting ? 'Posting...' : 'Post to The Troth Hearth'}
                </button>
            </form>

            {/* Post Feed */}
            <div className="space-y-4 pt-2">
                {posts.length === 0 ? (
                    <p className="text-center text-gray-400 py-8">No posts yet. Be the first to build Troth!</p>
                ) : (
                    posts.map(post => (
                        <div key={post.id} className="bg-gray-800 p-3 rounded-xl border border-gray-700">
                            <div className="flex items-center justify-between text-sm mb-1">
                                <span className={`font-bold ${post.userId === userId ? 'text-lime-400' : 'text-gray-300'}`}>
                                    {getDisplayName(post.userId)}
                                </span>
                                <span className="text-gray-500">
                                    {new Date(post.timestamp).toLocaleString()}
                                </span>
                            </div>
                            <p className="text-gray-200 whitespace-pre-wrap">{post.content}</p>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};


const App = () => {
    const [authReady, setAuthReady] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [userId, setUserId] = useState(null);
    const [activeTab, setActiveTab] = useState('focus');
    const [scoreHistory, setScoreHistory] = useState([]);
    const [crucibleHistory, setCrucibleHistory] = useState([]);
    const [audioLoading, setAudioLoading] = useState(false);
    
    // Auth Listener and Initial Sign-In
    useEffect(() => {
        if (!auth) {
            setAuthReady(true);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setIsAuthenticated(true);
                setUserId(user.uid);
            } else {
                try {
                    const token = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
                    if (token) {
                        await signInWithCustomToken(auth, token);
                    } else {
                        await signInAnonymously(auth);
                    }
                } catch (e) {
                    console.error("Firebase Auth Error:", e);
                }
            }
            setAuthReady(true);
        });

        return () => unsubscribe();
    }, []);
    
    // Firestore Listeners (IFS Score & Crucible Check-in)
    useEffect(() => {
        if (!db || !authReady) return;

        // 1. Listen to Public IFS Scores
        const qScores = query(collection(db, `artifacts/${appId}/public/data/ifs_daily_scores`), orderBy("timestamp", "desc"));
        const unsubscribeScores = onSnapshot(qScores, (snapshot) => {
            const scores = snapshot.docs.map(doc => doc.data());
            setScoreHistory(scores);
        }, (error) => console.error("Error fetching IFS scores:", error));
        
        // 2. Listen to Private Crucible Check-ins
        if (userId) {
            const qCrucible = query(collection(db, `artifacts/${appId}/users/${userId}/daily_checkins`), orderBy("timestamp", "desc"));
            const unsubscribeCrucible = onSnapshot(qCrucible, (snapshot) => {
                const checkins = snapshot.docs.map(doc => doc.data());
                setCrucibleHistory(checkins);
            }, (error) => console.error("Error fetching crucible:", error));
            
            return () => {
                unsubscribeScores();
                unsubscribeCrucible();
            };
        }
        
        return () => unsubscribeScores();
    }, [authReady, userId]);

    if (!authReady) {
        return <AppLoader />;
    }
    
    // Separate the current user's history for the Analytics tab
    const currentUserScoreHistory = scoreHistory.filter(score => score.targetUserId === userId);

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center">
            
            {/* Header */}
            <header className="w-full bg-gray-800 shadow-2xl p-4 sticky top-0 z-10 border-b-4 border-lime-500/50">
                <div className="max-w-4xl mx-auto flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                        <TRULogo className="w-10 h-10"/>
                        <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-wider">
                            TRU <span className="text-lime-500">CONVENANT</span> CONSOLE
                        </h1>
                    </div>
                    <div className="text-sm text-gray-400 hidden sm:block">
                        <User size={16} className="inline mr-1"/> 
                        {userId ? `ID: ${userId.substring(0, 10)}...` : 'Anonymous'}
                    </div>
                </div>
            </header>

            {/* Navigation Tabs */}
            <div className="w-full bg-gray-900 border-b border-gray-700 sticky top-[68px] z-10">
                <div className="max-w-4xl mx-auto flex justify-around">
                    {[
                        { id: 'focus', label: 'Daily Focus', icon: Heart },
                        { id: 'log', label: 'IFS Daily Log', icon: Target },
                        { id: 'analytics', label: 'Analytics', icon: BarChart },
                        { id: 'hearth', label: 'Troth Hearth', icon: MessageSquare },
                        { id: 'ethos', label: 'Ethos & Mandates', icon: Shield }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex-1 py-3 px-2 text-sm sm:text-base font-bold transition-all duration-200 
                                       ${activeTab === tab.id 
                                           ? 'text-lime-500 border-b-4 border-lime-500' 
                                           : 'text-gray-400 hover:bg-gray-800'}`}
                        >
                            <tab.icon size={18} className="inline mr-2 hidden sm:inline" />
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <main className="max-w-4xl w-full p-4 flex-grow">
                <div className="bg-gray-900 rounded-xl">
                    {activeTab === 'focus' && <DailyFocus userId={userId} audioLoading={audioLoading} fetchTTS={fetchTTSAudio} setAudioLoading={setAudioLoading} />}
                    {activeTab === 'log' && <DailyIFSLog userId={userId} isAuthenticated={isAuthenticated} scoreHistory={scoreHistory} crucibleHistory={crucibleHistory} clients={buildClientList(scoreHistory)} />}
                    {activeTab === 'analytics' && <DataAnalytics isAuthenticated={isAuthenticated} scoreHistory={currentUserScoreHistory} />}
                    {activeTab === 'hearth' && <TrothHearth isAuthenticated={isAuthenticated} userId={userId} />}
                    {activeTab === 'ethos' && <EthosAndMandates />}
                </div>
            </main>
            
            {/* Footer */}
            <footer className="w-full bg-gray-800 p-3 text-center text-xs text-gray-500 border-t border-gray-700">
                &copy; {new Date().getFullYear()} Two Ravens United (TRU). All rights reserved. Mandate of Radical Transparency Enforced.
            </footer>
        </div>
    );
};

export default App;

