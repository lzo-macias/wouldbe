import React, { useState } from 'react'
import TOSPrivacyForm from "../../component/signup/TOSPrivacyForm";
import ProfileStep from "../../component/signup/ProfileStep";
import AdditionalInfo from '../../component/signup/AdditionalInfo';

function Signup() {

    // which screen is showing
    const [screen, setScreen] = useState("1");

    // collected on screen 1, passed down to ProfileStep on screen 2
    const [accepted_tos, setAccepted_tos] = useState(false);
    const [accepted_privacy, setAccepted_privacy] = useState(false);

    // NOTE: ProfileStep owns its own field state (username/email/password/…),
    // so these may be redundant here — keep only what Signup actually passes down.
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [dateOfBirth, setDateOfBirth] = useState("");
    const [profilePhoto, setProfilePhoto] = useState("");
    const [ageVerifiedValue, setAgeVerifiedValue] = useState(false);
    const [userId, setUserId] = useState("")
    

    const [politicalLeaning, setPoliticalLeaning] = useState("");
    const [areasOfInterest, setAreasOfInterest] = useState("");
    const [firstname, setFirstName] = useState("");
    const [lastname, setLastName] = useState("");
    const [state, setState] = useState("");

    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);

    // ── Render lookup. Must be BELOW the useState calls so the setters exist. ──
    const screens = {
        "1": (
            <TOSPrivacyForm
                onComplete={({ accepted_tos, accepted_privacy }) => {
                    setAccepted_tos(accepted_tos);        // store the lifted values
                    setAccepted_privacy(accepted_privacy);
                    setScreen("2");                        // ← advance to ProfileStep
                }}
            />
        ),
        "2": (
            <ProfileStep
                accepted_tos={accepted_tos}                // pass the booleans down
                accepted_privacy={accepted_privacy}
                onComplete={(userId) => setScreen("3")}          // ProfileStep calls this after signup
            />
        ),
        "3": <AdditionalInfo/>         // replace with <AdditionalInfo /> when ready
    };

    return <div>{screens[screen] ?? null}</div>;
}

export default Signup
