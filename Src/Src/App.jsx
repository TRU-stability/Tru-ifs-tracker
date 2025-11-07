import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence
} from 'firebase/auth';
import { 
    getFirestore, 
    doc, 
    setDoc, 
    collection, 
    query, 
    orderBy, 
    onSnapshot, 
    getDocs, 
    serverTimestamp,
    limit,
    where
} from 'firebase/firestore';

// --- Global Variables (Provided by Canvas Environment) ---
// We must check if these exist to ensure the app doesn't crash outside of Canvas
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Firebase Initialization and Services ---
let firebaseApp, db, auth;
if (firebaseConfig) {
    try {
        firebaseApp = initializeApp(firebaseConfig);
        db = getFirestore(firebaseApp);
        auth = getAuth(firebaseApp);
        // Enable local persistence for better mobile experience
        setPersistence(auth, browserLocalPersistence);
    } catch (e) {
        console.error("Firebase Initialization Failed:", e);
    }
}

// --- CONSTANTS ---
const API_URL_GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=";
const VOICES = ['Kore', 'Puck', 'Charon']; // Voices for TTS
const NAV_ITEMS = ["Daily Focus", "Daily IFS Log", "Data Analytics", "Ethos & Mandates"];

// IFS Categories and Weights
const IFS_WEIGHTS = {
    fortitude: 0.40, // Internal Fortitude (40%)
    accountability: 0.40, // External Accountability (40%)
    integrity: 0.20 // High-Stakes Integrity (20%)
};

// Nine Noble Virtues Content
const VIRTUE_CONTENT = [
    { name: "Courage", focus: "Facing difficulty with dignity and resolving confrontation.", description: "The strength to confront adversity and the resolve to honor commitments. It builds your fortress." },
    { name: "Truth", focus: "Honesty in word and deed, especially when consequences are high.", description: "Living without deception. This includes adherence to the Synthetic Compound Integrity (SCI) Mandate." },
    { name: "Honor", focus: "Upholding one's reputation and moral obligations to the community.", description: "The integrity that earns respect and makes your word your bond." },
    { name: "Fidelity", focus: "Loyalty and faithfulness to commitments, crew, and covenant.", description: "Remaining steadfast to your purpose and the people who depend on you." },
    { name: "Discipline", focus: "Self-control and consistent adherence to scheduled tasks and habits.", description: "Mastery over self; the engine that powers sustained effort." },
    { name: "Hospitality", focus: "Treating others with respect and generosity, regardless of status.", description: "Showing grace and support to those who enter your sphere of influence." },
    { name: "Self-Reliance", focus: "Taking personal responsibility and initiating necessary actions without prompting.", description: "Belief in your own capacity to provide, act, and resolve challenges." },
    { name: "Industriousness", focus: "Working diligently, efficiently, and focusing on long-term production.", description: "Consistent effort aimed at creating lasting value through trade and craft." },
    { name: "Perseverance", focus: "Maintaining effort despite setbacks and embracing long, slow growth.", description: "The refusal to yield; embracing the grind of transformation." }
];

// --- Utility Functions ---

/**
 * Calculates VC, RJB, and Graduation triggers based on 30 days of IFS data.
 */
const calculateTriggers = (history) => {
    // Sort history by date descending
    const sortedHistory = history.sort((a, b) => b.timestamp - a.timestamp);
    const last30Days = sortedHistory.slice(0, 30);
    
    let vcWarningDays = 0; // Consecutive days below 75%
    let rjbReviewDays = 0; // Total days below 50% (last 30)
    let gradTrackDays = 0; // Consecutive days above 90%

    // 1. Calculate VC and Grad Track (Consecutive from most recent)
    for (let i = 0; i < sortedHistory.length; i++) {
        const score = sortedHistory[i].IFS;

        if (i === 0) { // Start with the most recent day
            if (score >= 90) {
                gradTrackDays = 1;
            } else if (score < 75) {
                vcWarningDays = 1;
            }
        } else {
            // Check Graduation Track
            if (gradTrackDays === i && score >= 90) {
                gradTrackDays++;
            } else if (gradTrackDays === i) {
                // Stop counting consecutive days if the streak is broken
                // gradTrackDays remains at the current count
            }

            // Check VC Sanction Warning (3 consecutive days below 75%)
            if (vcWarningDays === i && score < 75) {
                vcWarningDays++;
            } else if (vcWarningDays === i) {
                // Stop counting consecutive days if the streak is broken
                // vcWarningDays remains at the current count
            }
        }
    }

    // 2. Calculate RJB Review Days (Total days below 50% in the last 30)
    rjbReviewDays = last30Days.filter(entry => entry.IFS < 50).length;

    return {
        vcSanction: vcWarningDays >= 3, // Trigger at 3 consecutive days < 75%
        rjbReview: rjbReviewDays >= 5, // Trigger at 5 total days < 50% in the last 30
        gradTrackDays: gradTrackDays, // Total consecutive days >= 90%
        averageIFS: history.length > 0 ? (history.reduce((sum, entry) => sum + entry.IFS, 0) / history.length).toFixed(1) : 0,
        rjbCount: rjbReviewDays
    };
};

// --- Custom Components ---

const LoadingSpinner = () => (
    <div className="flex justify-center items-center py-6">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lime-500"></div>
    </div>
);

const IconButton = ({ children, onClick, disabled = false, className = "" }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={`p-2 rounded-full transition duration-300 ${
            disabled ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-gray-800 hover:bg-lime-600 text-lime-500 hover:text-white shadow-lg'
        } ${className}`}
    >
        {children}
    </button>
);

const MessageModal = ({ title, message, onClose, buttons }) => {
    if (!message) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm border border-lime-500/50">
                <div className="p-6">
                    <h3 className="text-xl font-bold text-lime-400 mb-3">{title}</h3>
                    <p className="text-gray-300 text-sm mb-6">{message}</p>
                    <div className="flex justify-end space-x-3">
                        {buttons || (
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-lime-600 text-white font-medium rounded-lg hover:bg-lime-500 transition"
                            >
                                Close
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- IFS LOGIC COMPONENTS ---

const DailyIFSLog = ({ userId, db, auth, history, setGlobalMessage }) => {
    const [scores, setScores] = useState({ fortitude: 50, accountability: 50, integrity: 50 });
    const [note, setNote] = useState('');
    const [crucible, setCrucible] = useState({ truth: false, fidelity: false, courage: false });
    const [showCrucible, setShowCrucible] = useState(false);
    const [isLogging, setIsLogging] = useState(false);

    // Check if the user has already logged a score today
    const hasLoggedToday = useMemo(() => {
        const today = new Date().toDateString();
        return history.some(entry => new Date(entry.createdAt).toDateString() === today);
    }, [history]);

    const calculateIFS = useCallback(() => {
        const totalScore = (
            (scores.fortitude * IFS_WEIGHTS.fortitude) +
            (scores.accountability * IFS_WEIGHTS.accountability) +
            (scores.integrity * IFS_WEIGHTS.integrity)
        );
        return Math.round(totalScore);
    }, [scores]);

    const handleLogIFS = async () => {
        if (!userId) {
            setGlobalMessage({ title: "Authentication Required", message: "Please wait for authentication to complete before logging scores." });
            return;
        }
        
        const finalIFS = calculateIFS();

        if (finalIFS < 0) {
            setGlobalMessage({ title: "Validation Error", message: "IFS score cannot be negative. Check your inputs." });
            return;
        }

        setIsLogging(true);
        try {
            // Firestore security rule path: /artifacts/{appId}/users/{userId}/client_history
            const docRef = doc(collection(db, `artifacts/${appId}/users/${userId}/client_history`));
            
            await setDoc(docRef, {
                IFS: finalIFS,
                rawScores: scores,
                virtueNote: note,
                createdAt: new Date(),
                timestamp: serverTimestamp(),
                userId: userId,
                crucible: crucible,
            });

            setGlobalMessage({ 
                title: "Log Successful", 
                message: `IFS Score of ${finalIFS}% logged successfully.`,
                type: 'success'
            });
            
            // Reset for next day
            setScores({ fortitude: 50, accountability: 50, integrity: 50 });
            setNote('');
            setCrucible({ truth: false, fidelity: false, courage: false });
            setShowCrucible(false);

        } catch (error) {
            console.error("Error logging IFS:", error);
            setGlobalMessage({ 
                title: "Logging Error", 
                message: "Failed to log score. Check console for details.",
                type: 'error'
            });
        } finally {
            setIsLogging(false);
        }
    };

    const renderSlider = (key, label, description) => (
        <div className="mb-6 p-4 border border-gray-700/50 rounded-lg bg-gray-900/50">
            <label className="block text-lg font-semibold text-lime-400 mb-1">{label} ({IFS_WEIGHTS[key] * 100}%)</label>
            <p className="text-xs text-gray-400 mb-3">{description}</p>
            <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={scores[key]}
                onChange={(e) => setScores({ ...scores, [key]: parseInt(e.target.value) })}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-lime-500"
            />
            <div className="text-right text-gray-300 font-mono text-xl mt-1">{scores[key]}%</div>
        </div>
    );

    const renderCrucibleCheck = (key, label) => (
        <div 
            onClick={() => setCrucible(c => ({ ...c, [key]: !c[key] }))}
            className={`flex items-center space-x-3 p-3 rounded-lg cursor-pointer transition duration-200 border ${
                crucible[key] ? 'bg-lime-600 border-lime-500 shadow-lg' : 'bg-gray-700 border-gray-600 hover:bg-gray-600'
            }`}
        >
            <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center ${
                crucible[key] ? 'border-white bg-white' : 'border-lime-500'
            }`}>
                {crucible[key] && <svg className="w-4 h-4 text-lime-700" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 13.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"></path></svg>}
            </div>
            <span className="text-gray-100 font-medium">{label}</span>
        </div>
    );


    return (
        <div className="p-4 sm:p-6 max-w-lg mx-auto">
            <h2 className="text-3xl font-extrabold text-lime-400 mb-6 text-center">Daily Integrity Log</h2>
            
            {hasLoggedToday ? (
                 <div className="bg-gray-800 p-6 rounded-xl border border-lime-700/50 text-center">
                    <p className="text-xl font-semibold text-gray-200">Daily Submission Complete</p>
                    <p className="text-sm text-gray-400 mt-2">You have logged your IFS score for today. Check back tomorrow for the next assessment.</p>
                </div>
            ) : (
                <>
                {/* --- Step 1: IFS Score Input --- */}
                <div className={`${showCrucible ? 'hidden' : 'block'}`}>
                    <div className="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-xl">
                        {renderSlider('fortitude', 'NNV I: Internal Fortitude (Courage, Truth, Honor)', 'Self-assessment of internal resolve and commitment to the SCI Mandate.')}
                        {renderSlider('accountability', 'NNV II: External Accountability (Fidelity, Discipline, Hospitality)', 'Assessment of adherence to external schedules, duties, and covenant agreements.')}
                        {renderSlider('integrity', 'NNV III: High-Stakes Integrity (Self-Reliance, Industriousness, Perseverance)', 'Assessment of critical pass/fail metrics, including adherence to the Synthetic Compound Integrity (SCI) Mandate.')}
                        
                        <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-400 mb-1">Virtue Note (Self-Reflection):</label>
                            <textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows="3"
                                placeholder="Reflect on your highest and lowest score areas today..."
                                className="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:ring-lime-500 focus:border-lime-500 resize-none"
                            />
                        </div>

                        <div className="flex justify-between items-center mt-6 p-4 bg-gray-700 rounded-lg">
                            <span className="text-xl font-bold text-white">Projected IFS:</span>
                            <span className="text-4xl font-extrabold text-lime-400">{calculateIFS()}%</span>
                        </div>

                        <button
                            onClick={() => setShowCrucible(true)}
                            disabled={isLogging}
                            className="w-full mt-6 py-3 bg-lime-600 text-white font-bold text-lg rounded-xl hover:bg-lime-500 transition duration-300 shadow-lg disabled:bg-gray-700 disabled:text-gray-500"
                        >
                            {isLogging ? <LoadingSpinner /> : "Proceed to The Daily Crucible →"}
                        </button>
                    </div>
                </div>

                {/* --- Step 2: The Daily Crucible --- */}
                <div className={`${showCrucible ? 'block' : 'hidden'} mt-6`}>
                    <h3 className="text-2xl font-bold text-white mb-4">The Daily Crucible</h3>
                    <p className="text-gray-400 mb-6 text-sm">A micro-confrontation to test your immediate self-assessment. Answer these three core NNV questions honestly. This data is critical for deep analytics.</p>

                    <div className="space-y-4">
                        {renderCrucibleCheck('truth', 'Did you avoid one specific opportunity for deception today? (Truth)')}
                        {renderCrucibleCheck('fidelity', 'Did you fulfill one specific promise you made to another person? (Fidelity)')}
                        {renderCrucibleCheck('courage', 'Did you confront one necessary but uncomfortable task? (Courage)')}
                    </div>

                    <button
                        onClick={handleLogIFS}
                        disabled={isLogging}
                        className="w-full mt-8 py-3 bg-lime-500 text-gray-900 font-extrabold text-lg rounded-xl hover:bg-lime-400 transition duration-300 shadow-2xl disabled:bg-gray-700 disabled:text-gray-500"
                    >
                        {isLogging ? <LoadingSpinner /> : `Finalize Log (IFS: ${calculateIFS()}%)`}
                    </button>
                    <button
                        onClick={() => setShowCrucible(false)}
                        className="w-full mt-3 py-2 text-lime-400 font-medium rounded-xl hover:text-white transition"
                    >
                        ← Back to Score Adjust
                    </button>
                </div>
                </>
            )}
        </div>
    );
};

// --- DATA ANALYTICS COMPONENT ---

const DataAnalytics = ({ history, userId, auth, triggers }) => {
    const { vcSanction, rjbReview, gradTrackDays, averageIFS, rjbCount } = triggers;

    const TriggerCard = ({ title, value, mandate, colorClass, condition }) => (
        <div className={`p-5 rounded-xl border-t-4 ${colorClass} bg-gray-800 shadow-xl`}>
            <p className="text-sm font-medium text-gray-400">{title}</p>
            <p className={`text-3xl font-extrabold mt-1 ${colorClass.includes('red') ? 'text-red-500' : 'text-white'}`}>
                {value}
            </p>
            {condition && (
                <p className="text-xs mt-2 font-semibold text-lime-400 border-t border-gray-700 pt-2">
                    {mandate}
                </p>
            )}
        </div>
    );

    const HistoryTable = () => (
        <div className="overflow-x-auto bg-gray-800 rounded-xl shadow-lg mt-6 border border-gray-700/50">
            <table className="min-w-full divide-y divide-gray-700">
                <thead className="bg-gray-700">
                    <tr>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-1/4">Date</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-1/4">IFS (%)</th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Triggers</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                    {history.slice(0, 30).map((entry, index) => {
                        const date = entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : 'N/A';
                        const score = entry.IFS;
                        
                        const isRJB = score < 50;
                        const isVC = score < 75;
                        const isGrad = score >= 90;

                        const rowClass = isRJB ? 'bg-red-900/40 border-red-500/50' : isGrad ? 'bg-lime-900/40 border-lime-500/50' : 'bg-gray-900/50';
                        const textClass = isRJB ? 'text-red-400 font-bold' : isGrad ? 'text-lime-400 font-bold' : 'text-gray-300';
                        
                        return (
                            <tr key={index} className={rowClass}>
                                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-400">{date}</td>
                                <td className={`px-3 py-2 whitespace-nowrap text-sm ${textClass}`}>{score}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-400">
                                    {isRJB && <span c
