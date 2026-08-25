import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from "react-router-dom";
import api from "../../lib/api"
import { uploadAvatar, getAvatarStatus, describeAvatarStatus, ACCEPTED_IMAGE_TYPES } from "../../lib/avatarUpload";
import "./Signup.css";
import { CameraIcon, MapPinIcon, TagIcon, TextIcon, ChevronDown, ArrowRight } from "./icons";

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

// Screen 3 of signup (Figma "page 3") — optional profile enrichment on the
// already-created user. Authenticated with the token + userId stored after the
// account step. Saves profile fields → PUT /api/users/update/:id and interests →
// PUT /api/users/:id/interests. The whole step is skippable.
function AdditionalInfo() {
    const navigate = useNavigate();

    const userId = localStorage.getItem("userId");

    // Profile photo. `preview` is a local object URL shown the instant a file is
    // picked — the real one is only published once moderation clears it, and we
    // don't make the user stare at an empty circle until then.
    const fileInputRef = useRef(null);
    const [preview, setPreview] = useState("");
    const [photoStatus, setPhotoStatus] = useState(null);   // content_item.moderation_status
    const [photoBusy, setPhotoBusy] = useState("");         // preparing|requesting|uploading|registering
    const [photoError, setPhotoError] = useState(null);
    const [dragOver, setDragOver] = useState(false);

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
        api.get(`/api/categories`)
            .then((res) => setCategories(res.data || []))
            .catch(() => setCategories([]));
    }, []);

    // Release the object URL when it's replaced or the screen unmounts —
    // otherwise every re-pick leaks the decoded image for the tab's lifetime.
    useEffect(() => {
        if (!preview) return;
        return () => URL.revokeObjectURL(preview);
    }, [preview]);

    // Poll while a verdict is outstanding. Stops on any terminal state, and on
    // unmount, so leaving the screen mid-review doesn't leave a timer running.
    useEffect(() => {
        const waiting = ["pending_moderation", "pending_human_review", "flagged"];
        if (!waiting.includes(photoStatus)) return;

        let cancelled = false;
        const id = setInterval(async () => {
            try {
                const item = await getAvatarStatus();
                if (cancelled) return;
                if (item?.moderation_status) setPhotoStatus(item.moderation_status);
            } catch {
                /* transient — the next tick retries */
            }
        }, 5000);

        return () => { cancelled = true; clearInterval(id); };
    }, [photoStatus]);

    async function handlePhoto(file) {
        if (!file) return;
        setPhotoError(null);
        setPhotoStatus(null);
        setPreview((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(file);
        });
        try {
            const item = await uploadAvatar(file, { onProgress: setPhotoBusy });
            setPhotoStatus(item.moderation_status);
        } catch (err) {
            setPhotoError(err.response?.data?.error || err.message || "Could not upload that photo");
            setPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return ""; });
        } finally {
            setPhotoBusy("");
        }
    }

    function toggleInterest(key) {
        setInterests((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
    }

    async function save() {
        // profile_photo_url is deliberately absent: the server rejects it here and
        // sets it itself once the uploaded photo clears moderation.
        await api.put(
            `/api/users/update/${userId}`,
            {
                state: state || null,
                bio: bio || null,
                political_lean: Number(lean),
            }
        );
        if (interests.length) {
            await api.put(`/api/users/${userId}/interests`, { category_keys: interests });
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

                {/* profile photo — accept="image/*" is what makes the OS offer
                    Camera / Photo Library / Files on mobile and the native picker
                    on desktop. No `capture` attribute on purpose: it would force
                    the camera and remove the library option entirely. */}
                <div className="su-avatar-block">
                    <div
                        className={`su-avatar${dragOver ? " is-dragover" : ""}`}
                        role="button"
                        tabIndex={0}
                        title="Add a profile photo"
                        onClick={() => fileInputRef.current?.click()}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); }
                        }}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setDragOver(false);
                            handlePhoto(e.dataTransfer.files?.[0]);
                        }}
                        onPaste={(e) => handlePhoto(e.clipboardData?.files?.[0])}
                    >
                        {preview ? <img src={preview} alt="profile" /> : <CameraIcon />}
                        {photoBusy && <span className="su-avatar-veil">{photoBusy}…</span>}
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPTED_IMAGE_TYPES}
                        hidden
                        onChange={(e) => {
                            handlePhoto(e.target.files?.[0]);
                            e.target.value = "";   // so re-picking the same file fires onChange
                        }}
                    />
                    <div className="su-avatar-meta">
                        <span className="su-avatar-label">profile photo</span>
                        {photoError
                            ? <span className="su-avatar-note is-error">{photoError}</span>
                            : describeAvatarStatus(photoStatus).label
                                ? <span className={`su-avatar-note is-${describeAvatarStatus(photoStatus).tone}`}>
                                    {describeAvatarStatus(photoStatus).label}
                                  </span>
                                : null}
                    </div>
                </div>

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
