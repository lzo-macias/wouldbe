// ============================================================================
// REACT B — CategorySlider (the horizontal row that hosts the flyouts)
// ----------------------------------------------------------------------------
// The scrollable row of category chips. Each chip is wrapped in a CategoryFlyout
// (React A) and passed AS ITS CHILD, so the flyout can render the chip plus its
// hover menu. The row itself is a normal horizontal scroller — safe to clip now,
// because each menu is portaled to <body>.
//
// Fill in the TODOs from memory, then diff against the `.categoryslider` map in
//   .../ChooseYourIssues/ChooseYourIssues.jsx
//
// CONCEPT CHECK:
//   • `allCategories` is an array of STRINGS (unique groups, problem 01). So the
//     map param is the group string — what would `c.category_group` be on a
//     string, and what crash did that cause? (Hint: titleCase(undefined).)
//   • The chip <li> is written BETWEEN <CategoryFlyout> tags. What prop does that
//     become inside CategoryFlyout?
//   • Which element gets the React `key` — the outer CategoryFlyout or the inner
//     <li>? (The one the .map returns.)
//   • The CSS `.categoryslider` uses overflow-x:auto. Why is that OK for the menu
//     now but wasn't before? (problem 05)
// ============================================================================

import React from "react";
import CategoryFlyout from "./CategoryFlyout";

function CategorySlider({ allCategories, allInterests, myInterests, toggle, isMyCategory, titleCase }) {
    return (
        <ul className="categoryslider">
            {allCategories.map((group) => (
                // TODO: wrap each chip in <CategoryFlyout ...> and give the OUTER
                //       element key={group}. Pass allInterests, category_group={group},
                //       myInterests, toggle. Put the chip <li> as the CHILD.
                <CategoryFlyout
                    key={group}
                    allInterests={allInterests}
                    category_group={group}
                    myInterests={myInterests}
                    toggle={toggle}
                >
                    <li className={isMyCategory(group) ? "selectedCategory" : "Category"}>
                        {titleCase(group) /* group is a STRING — don't read .category_group */}
                    </li>
                </CategoryFlyout>
            ))}
        </ul>
    );
}

export default CategorySlider;
