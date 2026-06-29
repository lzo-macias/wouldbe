import React, { useState, useEffect } from 'react'
import { useNavigate } from "react-router-dom";
import axios from "axios"
import "../../styling/Signup.css";
import { CameraIcon, MapPinIcon, TagIcon, TextIcon, ChevronDown, ArrowRight } from "./icons";

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

// Screen 3 of signup (Figma "page 3") — optional profile enrichment on the
// already-created user. Authenticated with the token + userId stored after the
// account step. Saves profile fields → PUT /api/users/update/:id and interests →
// PUT /api/users/:id/interests. The whole step is skippable.
function AdditionalInfo() {
    const API = import.meta.env.VITE_API_BASE_URL;
    const navigate = useNavigate();

    const userId = localStorage.getItem("userId");
    const token = localStorage.getItem("token");
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    const [photoUrl, setPhotoUrl] = useState("");
    const [showPhotoInput, setShowPhotoInput] = useState(false);
    const [state, setState] = useState("");
    const [bio, setBio] = useState("");
    const [lean, setLean] = useState(5);                  // 1 conservative … 10 progressive
    const [interests, setInterests] = useState([]);        // category_key[]
    const [categories, setCategories] = useState([]);
    const [interestsOpen, setInterestsOpen] = useState(false);

    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    // issue-category vocabulary for the interests picker (public endpoint)
    useEffect(() => {
        axios.get(`${API}/api/categories`)
            .then((res) => setCategories(res.data || []))
            .catch(() => setCategories([]));
    }, [API]);

    function toggleInterest(key) {
        setInterests((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
    }

    async function save() {
        await axios.put(
            `${API}/api/users/update/${userId}`,
            {
                profile_photo_url: photoUrl || null,
                state: state || null,
                bio: bio || null,
                political_lean: Number(lean),
            },
            auth
        );
        if (interests.length) {
            await axios.put(`${API}/api/users/${userId}/interests`, { category_keys: interests }, auth);
        }
    }

    async function handleFinish() {
        setError(null);
        setLoading(true);
        try {
            await save();
            navigate("/");
        } catch (err) {
            setError(err.response?.data?.error || "Could not save your info. You can finish later from settings.");
        } finally {
            setLoading(false);
        }
    }

    // group categories by category_group for a tidy picker
    const grouped = categories.reduce((acc, c) => {
        (acc[c.category_group] = acc[c.category_group] || []).push(c);
        return acc;
    }, {});

    // slider bubble position (value 1..10 → 0..100%)
    const bubbleLeft = `${((Number(lean) - 1) / 9) * 100}%`;

    return (
        <div className="su-page">
            <div className="su-card">
                <h1 className="su-logo">would be</h1>
                <p className="su-heading">Set up your profile</p>

                {error && <p className="su-error">{error}</p>}

                {/* profile photo */}
                <div className="su-avatar-block">
                    <div className="su-avatar" onClick={() => setShowPhotoInput((s) => !s)} title="Add a profile photo">
                        {photoUrl ? <img src={photoUrl} alt="profile" onError={() => setPhotoUrl("")} /> : <CameraIcon />}
                    </div>
                    <span className="su-avatar-label">profile photo</span>
                </div>
                {showPhotoInput && (
                    <div className="su-field" style={{ marginBottom: 18 }}>
                        <div className="su-input">
                            <input placeholder="Paste an image URL" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} />
                        </div>
                    </div>
                )}

                {/* state */}
                <div className="su-field" style={{ marginBottom: 18 }}>
                    <div className="su-input">
                        <MapPinIcon />
                        <select value={state} onChange={(e) => setState(e.target.value)} required>
                            <option value="" disabled>Select your state</option>
                            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <ChevronDown className="su-chev" />
                    </div>
                </div>

                {/* rate your politics */}
                <div className="su-slider-block">
                    <div className="su-slider-title">Rate Your Politics</div>
                    <div className="su-slider-row">
                        <div className="su-bubble" style={{ left: bubbleLeft }}>{lean}</div>
                        <input
                            className="su-range"
                            type="range" min="1" max="10" step="1"
                            value={lean}
                            onChange={(e) => setLean(e.target.value)}
                        />
                        <div className="su-ends"><span>conservative</span><span>progressive</span></div>
                    </div>
                </div>

                {/* interests */}
                <div className="su-field" style={{ marginTop: 18 }}>
                    <div className="su-dropdown">
                        <div className="su-input" onClick={() => setInterestsOpen((o) => !o)} style={{ cursor: "pointer" }}>
                            <TagIcon />
                            <span style={{ flex: 1, color: interests.length ? "#1a1a1a" : "#777", fontWeight: 500, fontSize: 16 }}>
                                {interests.length ? `${interests.length} issue${interests.length > 1 ? "s" : ""} selected` : "Issues you care about"}
                            </span>
                            <ChevronDown className="su-chev" />
                        </div>
                        {interestsOpen && (
                            <div className="su-dropdown-panel">
                                {Object.entries(grouped).map(([group, cats]) => (
                                    <div key={group} className="su-int-group">
                                        <h4>{group.replace(/_/g, " ")}</h4>
                                        {cats.map((c) => (
                                            <label key={c.category_key} className="su-int-option">
                                                <input type="checkbox" checked={interests.includes(c.category_key)} onChange={() => toggleInterest(c.category_key)} />
                                                {c.display_name}
                                            </label>
                                        ))}
                                    </div>
                                ))}
                                {!categories.length && <p style={{ color: "#777", fontSize: 13, margin: 0 }}>No categories available.</p>}
                            </div>
                        )}
                    </div>
                </div>

                {/* bio */}
                <div className="su-field" style={{ marginTop: 18 }}>
                    <div className="su-input">
                        <TextIcon />
                        <input placeholder="Short bio (optional)" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} />
                    </div>
                </div>

                <div className="su-footer">
                    <div className="su-footer-left">
                        <button type="button" className="su-cancel" onClick={() => navigate("/")}>skip for now</button>
                    </div>
                    <button type="button" className="su-primary" onClick={handleFinish} disabled={loading}>
                        {loading ? "SAVING…" : "FINISH"} <ArrowRight />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default AdditionalInfo
