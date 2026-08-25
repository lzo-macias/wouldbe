import React, { useState } from 'react'
import "./MyWouldBeShare.css"

// ============================================================================
// MyWouldBeShare — the share bar for a campaign.
//
// TWO KINDS OF BUTTON, because the platforms genuinely differ:
//
//   URL-BASED (X, WhatsApp, SMS, Threads, Bluesky)
//     Every one of these accepts a pre-filled message through a URL. Clicking
//     opens their composer with your text and link already in it. Just a link.
//
//   NO WEB SHARE AT ALL (Instagram, TikTok)
//     Neither has a share-by-URL endpoint — you cannot pre-fill an Instagram or
//     TikTok post from a web page, on any platform, by any URL. Anything that
//     claims otherwise is either linking to a profile or lying.
//     So those two buttons call the WEB SHARE API instead, which opens the
//     phone's native sheet where Instagram and TikTok are real targets. On
//     desktop, where that API mostly doesn't exist, they fall back to copying
//     the link — which is what you'd do by hand anyway.
//
// Everything opens in a new tab with rel="noopener noreferrer". Without
// `noopener`, the page you opened gets a handle on yours via window.opener and
// can navigate it somewhere else.
// ============================================================================

// encodeURIComponent on EVERY interpolated value. A campaign title with an
// ampersand — "Housing & Transit" — would otherwise terminate the query string
// early and drop everything after it.
const enc = encodeURIComponent

// iOS and Android disagree about the separator in an sms: link. iOS wants
// `sms:&body=`, Android wants `sms:?body=`. Getting it wrong opens Messages with
// an empty draft, which looks like the button silently failed.
const isIOS = () =>
    typeof navigator !== "undefined" &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        // iPadOS 13+ reports itself as a Mac; the touch points give it away.
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))

// Each entry builds its own URL — the parameter names are not interchangeable
// between platforms, which is why this is a lookup rather than one template.
const URL_TARGETS = [
    {
        key: "x",
        label: "X",
        icon: "/socialicons/x.svg",
        href: ({ url, text }) => `https://x.com/intent/tweet?url=${enc(url)}&text=${enc(text)}`,
    },
    {
        key: "whatsapp",
        label: "WhatsApp",
        icon: "/socialicons/whatsapp.svg",
        // wa.me takes ONE `text` param — the link goes inside it, not separately.
        href: ({ url, text }) => `https://wa.me/?text=${enc(`${text} ${url}`)}`,
    },
    {
        key: "sms",
        label: "SMS",
        icon: "/socialicons/sms.svg",
        href: ({ url, text }) =>
            `sms:${isIOS() ? "&" : "?"}body=${enc(`${text} ${url}`)}`,
        // sms: is a protocol handler, not a web page — opening it in a new tab
        // leaves a blank tab behind on some browsers.
        sameTab: true,
    },
    {
        key: "threads",
        label: "Threads",
        icon: "/socialicons/threads.svg",
        href: ({ url, text }) => `https://www.threads.net/intent/post?text=${enc(`${text} ${url}`)}`,
    },
    {
        key: "bluesky",
        label: "Bluesky",
        icon: "/socialicons/bluesky.svg",
        href: ({ url, text }) => `https://bsky.app/intent/compose?text=${enc(`${text} ${url}`)}`,
    },
]

// The two that have no web share endpoint.
const NATIVE_TARGETS = [
    { key: "instagram", label: "Instagram", icon: "/socialicons/instagram.svg" },
    { key: "tiktok", label: "TikTok", icon: "/socialicons/tiktok.svg" },
]

function MyWouldBeShare({ url, title, text }) {
    // `copied` doubles as the "which button did I just press" flag so the
    // confirmation appears on the button that was actually clicked.
    const [copied, setCopied] = useState(null)

    // Default to the page you're on, so the component works with no props while
    // you're wiring it up.
    const shareUrl = url ?? (typeof window !== "undefined" ? window.location.href : "")
    const shareTitle = title ?? "Back my campaign"
    const shareText = text ?? shareTitle

    async function copyLink(key = "copy") {
        try {
            await navigator.clipboard.writeText(shareUrl)
            setCopied(key)
            setTimeout(() => setCopied(null), 1800)
        } catch {
            // clipboard needs HTTPS (or localhost) and a user gesture; if it's
            // refused, show the URL so the user can copy it by hand rather than
            // leaving them with a button that did nothing.
            window.prompt("Copy this link:", shareUrl)
        }
    }

    // Instagram / TikTok: native sheet where it exists, copy where it doesn't.
    async function shareNatively(key) {
        if (navigator.share) {
            try {
                await navigator.share({ title: shareTitle, text: shareText, url: shareUrl })
                return
            } catch {
                // AbortError = the user dismissed the sheet. Not a failure, and
                // falling through to a copy would be surprising.
                return
            }
        }
        copyLink(key)
    }

    return (
        <div className="shareBar">
            <span className="shareBarLabel">Share</span>

            <ul className="shareList">
                {URL_TARGETS.map((t) => (
                    <li key={t.key}>
                        <a
                            className="shareBtn"
                            href={t.href({ url: shareUrl, text: shareText })}
                            {...(t.sameTab
                                ? {}
                                : { target: "_blank", rel: "noopener noreferrer" })}
                            aria-label={`Share on ${t.label}`}
                            title={`Share on ${t.label}`}
                        >
                            <img src={t.icon} alt="" />
                        </a>
                    </li>
                ))}

                {NATIVE_TARGETS.map((t) => (
                    <li key={t.key}>
                        <button
                            type="button"
                            className="shareBtn"
                            onClick={() => shareNatively(t.key)}
                            aria-label={`Share to ${t.label}`}
                            title={`Share to ${t.label}`}
                        >
                            <img src={t.icon} alt="" />
                            {copied === t.key && <span className="shareToast">Link copied</span>}
                        </button>
                    </li>
                ))}

                <li>
                    <button
                        type="button"
                        className="shareBtn"
                        onClick={() => copyLink("copy")}
                        aria-label="Copy link"
                        title="Copy link"
                    >
                        <img src="/socialicons/copylink.svg" alt="" />
                        {copied === "copy" && <span className="shareToast">Copied</span>}
                    </button>
                </li>
            </ul>
        </div>
    )
}

export default MyWouldBeShare
