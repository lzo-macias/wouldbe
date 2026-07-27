// ============================================================================
// REACT A — CategoryFlyout (createPortal + rect + guarded hover close)
// ----------------------------------------------------------------------------
// Wraps ONE category chip (`children`). On hover it opens a dropdown of that
// group's interests, rendered through a PORTAL to <body> so the scrolling row
// can't clip it (problem 05). It positions the menu from the chip's rect
// (problem 06) and stays open through clicks with a guarded close (problems 07/10).
//
// ⚠️ DEFINE THIS AT MODULE SCOPE — never inside the parent component. If it were
// nested, every parent re-render would make a NEW function, React would remount
// it, and its `hovered` state would reset → the menu closes the moment you click
// an item. (Problem 10. This is the bug we actually shipped.)
//
// Fill in the TODOs from memory, then diff against `MyInterestsDropDown` in
//   .../ChooseYourIssues/ChooseYourIssues.jsx
//
// CONCEPT CHECK — answer first:
//   • Why must this live at module scope, not inside ChooseYourIssues?
//   • Why createPortal(..., document.body) instead of rendering the <ul> inline?
//   • getBoundingClientRect() is relative to what? Which `position` pairs with it?
//   • The menu is NOT a DOM child of the chip. What fires on the chip when you
//     move toward the menu, and why do overChip/overMenu + a delay fix it?
//   • Why are overChip/overMenu refs, not state?
//   • onMouseEnter={openMenu} vs onMouseEnter={openMenu()} — what's the difference?
// ============================================================================

import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";

function CategoryFlyout({ allInterests, category_group, myInterests, toggle, children }) {
    const [hovered, setHovered] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 0 });
    const wrapRef = useRef(null);      // the chip, to measure
    const closeTimer = useRef(null);   // pending close timeout id
    const overChip = useRef(false);    // pointer over the chip?
    const overMenu = useRef(false);    // pointer over the menu?

    const items = allInterests.filter((i) => i.category_group === category_group);

    function openMenu() {
        // TODO: clearTimeout(closeTimer.current);
        //       read wrapRef's rect; setPos({top: rect.bottom, left: rect.left, minWidth: rect.width});
        //       setHovered(true)
    }

    function scheduleClose() {
        // TODO: clearTimeout(closeTimer.current);
        //       closeTimer.current = setTimeout(() => {
        //           if (!overChip.current && !overMenu.current) setHovered(false);
        //       }, 120)
    }

    return (
        <div
            ref={/* TODO: wrapRef */ null}
            className="categoryDropdownWrap"
            onMouseEnter={/* TODO: () => { overChip.current = true; openMenu() } */ null}
            onMouseLeave={/* TODO: () => { overChip.current = false; scheduleClose() } */ null}
        >
            {/* TODO: render the chip passed in (children) */}

            {hovered && createPortal(
                <ul
                    className="categoryDropdown"
                    style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}
                    onMouseEnter={() => { overMenu.current = true; clearTimeout(closeTimer.current); }}
                    onMouseLeave={() => { overMenu.current = false; scheduleClose(); }}
                >
                    {items.map((interest) => {
                        const selected = myInterests.some((i) => i.category_key === interest.category_key);
                        return (
                            <li
                                key={interest.category_key}
                                className={selected ? "selectedInterest" : "interest"}
                                onClick={() => toggle(interest.category_key)}
                            >
                                {interest.display_name}
                            </li>
                        );
                    })}
                </ul>,
                document.body   // OUTSIDE the scroll container — nothing clips it
            )}
        </div>
    );
}

export default CategoryFlyout;
