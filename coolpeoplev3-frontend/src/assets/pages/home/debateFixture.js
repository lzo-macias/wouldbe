/* ============================================================================
 * debateFixture — one debate, in the shape the page renders.
 *
 * FIXTURE, and deliberately so: /api/debates/:id/full returns the debate, its
 * contestants and its criteria, but this page needs a bracket to be ONE
 * QUESTION WITH MANY RESPONSES — released in order, each with per-response
 * engagement and a field behind the two seats — and the API has no read that
 * returns that shape yet. Wiring it is a backend conversation, not a styling
 * one, so the page is built against the shape we want to be handed.
 * ==========================================================================*/

// Authored per debate by the host.
export const CRITERIA = [
    { k: 'evidence',   n: 'Evidence',   s: 'Backed by something a reader can check' },
    { k: 'directness', n: 'Directness', s: 'Answers the question that was asked' },
    { k: 'fairness',   n: 'Fairness',   s: 'States the other side as its best self' },
    { k: 'force',      n: 'Force',      s: 'Would move somebody who disagrees' },
]

export const BONUS = 500
export const MAXPTS = CRITERIA.length * 5 * 100

/* Everybody who answers is in a bracket, but two of them hold the SEATS — they
 * are the contestants, and they are what the bracket is. The rest are the
 * field. A challenger from the field can outscore a seat and take it. */
export const PEOPLE = {
    'Marisol Ferrer':   { i: 'MF', noms: 412 },
    'Priya Venkatesh':  { i: 'PV', noms: 508,
        wouldbe: { t: 'Tenant Legal Fund', pct: 74, to: '/homev2' } },
    'Nadia Kaplan':     { i: 'NK', noms: 366 },
    'Bo Nakamura':      { i: 'BN', noms: 241 },
    'Cassius Moreau':   { i: 'CM', noms: 288 },
    'Leila Haddad':     { i: 'LH', noms: 305,
        wouldbe: { t: 'Ferry Street Survey', pct: 41, to: '/homev2' } },
    'Theo Adeyemi':     { i: 'TA', noms: 197 },
    'Aurelio Sandoval': { i: 'AS', noms: 0 },
}

export const DEBATE = {
    title: 'Should the city cap rent increases, or build its way out?',
    blurb: 'One question per bracket, released in order. Everybody answers the same question at the same time, and the answers publish together when the bracket closes — so nobody gets to read the other side first.',
    prizeCents: 180000,
    split: 'Split 60 / 30 / 10',
    host: { name: 'Imogen Vasquez', i: 'IV' },
}

export const BRACKETS = [
    {
        id: 'b1', n: 1, state: 'done', when: 'Closed Aug 26',
        q: 'A cap holds rents down for the people already inside it. What about everybody else?',
        seats: [
            { name: 'Marisol Ferrer', stance: 'for the cap', votes: 1284, reposts: 179, replies: 128,
              b: 'Everybody else is also inside something. The renter in the next building is one bad year from the same letter, and a cap is the only policy that reaches her before the letter does. ', pull: 'You do not fix a leak by explaining that the roof is the real problem.', b2: ' A cap is not a housing policy, it is a bridge to one — and refusing to build the bridge because you prefer the destination leaves people in the river. And I want to name the thing nobody running for this seat wants to name: the reason a cap is unpopular with people who study housing is that it is a blunt instrument, and the reason it is popular with people who rent is that a blunt instrument is still an instrument. I would rather hold something blunt than hold nothing at all while I wait for the elegant thing to arrive.' },
            { name: 'Bo Nakamura', stance: 'against', votes: 1109, reposts: 121, replies: 94,
              b: 'It prices them out, and the ones outside never get in. A cap is a transfer from the people who do not have a lease yet to the people who already do. ', pull: 'We have decided in advance which of them we can see.', b2: ' I will grant that the harm my opponent describes is real and arrives faster than mine does — that is the honest version of this disagreement, and it is still not a reason to make the shortage permanent. Here is the part I would want a voter to sit with. Every policy in this debate helps somebody. The difference is that mine helps a person you will never be able to interview, because they will simply never move to this city, and hers helps a person you can put on the news tonight. I understand exactly why that asymmetry decides elections. I do not think it should decide housing law.' },
        ],
        field: [
            { name: 'Priya Venkatesh', stance: 'for the cap', votes: 741, reposts: 88, replies: 52,
              b: 'Everybody else is the reason to write the cap narrowly and sunset it, not the reason to skip it. A policy that helps some people now and is reviewed in three years beats one that helps nobody until 2034.' },
            { name: 'Nadia Kaplan', stance: 'against', votes: 612, reposts: 71, replies: 44,
              b: "Everybody else waits, and they wait without knowing they are waiting, because a waiting list is not a constituency. The strongest version of my opponent's case is that visible harm should outrank invisible harm — I think that is exactly how cities end up with neither." },
            { name: 'Cassius Moreau', stance: 'against', votes: 388, reposts: 40, replies: 26,
              b: 'The people outside never get in, and the ones inside get a discount they will defend at every hearing for twenty years.' },
        ],
    },
    {
        id: 'b2', n: 2, state: 'done', when: 'Closed Aug 29',
        q: 'Name one building that does not get built if this passes.',
        seats: [
            { name: 'Leila Haddad', stance: 'against', votes: 1002, reposts: 143, replies: 88,
              b: 'The 340-unit on Ferry Street that went to entitlement in March and has not filed since. ', pull: 'I cannot prove the cap is why, and I will not pretend I can', b2: ' — but a pipeline going quiet has no press conference, no ribbon and nobody to interview, and six years later you have a shortage with no one who can be blamed for it.' },
            { name: 'Cassius Moreau', stance: 'against', votes: 874, reposts: 96, replies: 61,
              b: 'Nothing does not get built. That is the point, and it is the weakest-sounding true thing in this debate. ', pull: 'The buildings that do not get built do not have addresses', b2: ', which is exactly why you will never be handed the receipt you are asking my opponent for.' },
        ],
        // the winner of this bracket came from the field, not a seat
        field: [
            { name: 'Priya Venkatesh', stance: 'for the cap', votes: 1418, reposts: 207, replies: 132, chal: true,
              b: 'None, and I will say why that is not the win it sounds like. The buildings that do not get built have no addresses, which means neither side can name one — so the question is really about who has to carry the burden of an unprovable claim. I say the side asking a real family to pay for a hypothetical tower.' },
            { name: 'Marisol Ferrer', stance: 'for the cap', votes: 806, reposts: 91, replies: 55,
              b: 'I cannot name one, and neither can he. That cuts both ways, and I would rather defend a policy that is insufficient than one that is merely eventual.' },
            { name: 'Theo Adeyemi', stance: 'against', votes: 402, reposts: 38, replies: 22,
              b: 'Ask the question the other way. Name one family that is still in their apartment in March because a tower broke ground in 2031.' },
        ],
    },
    {
        id: 'b3', n: 3, state: 'open', when: 'Closes in 22h',
        q: 'Your opponent just named the cost of your position. Answer it.',
        seats: [
            { name: 'Marisol Ferrer', stance: 'for the cap', votes: 634, reposts: 74, replies: 41,
              b: 'It is a real cost and I will say so on a doorstep: a slower pipeline, and I am not going to pretend the number is zero. ', pull: 'Time is not housing — but it is the only thing that lets somebody still be here when the housing arrives.', b2: ' What I will not do is hand somebody an eviction notice and call it a long-term investment in their neighbourhood. The version of my position I would defend on television is the one where I say both halves out loud: cap now, build now, and accept that the first buys the time the second one needs. What I will not accept is the framing where naming a cost is the same as winning the argument. Everything has a cost. The question in front of the council is which of the two costs lands on somebody who cannot move.' },
            { name: 'Nadia Kaplan', stance: 'against', votes: 587, reposts: 66, replies: 38,
              b: 'My cost is that somebody is priced out this year and I did not stop it, and I am not going to dress that up. ', pull: 'I am saying the instrument they want has a worse version of the same cost', b2: ', paid by people who cannot yet be interviewed, and that a council which only counts the harms with names attached will keep choosing this way forever. I want to be precise about what I am conceding. The person my opponent describes is real, the letter arriving in thirty days is real, and nothing about a supply argument helps them in March. I am not asking anybody to pretend otherwise. I am asking whether the instrument that helps them in March also guarantees the next person in their position has nowhere to go at all — and I think, honestly, that it does.' },
        ],
        field: [
            { name: 'Aurelio Sandoval', stance: 'for the cap', votes: 812, reposts: 118, replies: 76, chal: true,
              b: 'You have priced the building. Now price the family. Every cost my opponent names is real and every one of them is denominated in permits, and the thing I am defending is denominated in people who will not be at this address in March. Tell me which unit of account the council is supposed to use.' },
            { name: 'Priya Venkatesh', stance: 'for the cap', votes: 549, reposts: 61, replies: 33,
              b: 'The cost is a slower pipeline and I will not pretend otherwise. I would rather answer for a delay than for a displacement, and I think most people asked plainly would say the same.' },
        ],
    },
    { id: 'b4', n: 4, state: 'lock', when: 'Opens Sep 3',
      q: 'Point to a city that already tried this and say what happened.' },
    { id: 'b5', n: 5, state: 'lock', when: 'Opens Sep 5', final: true,
      q: 'Last word. Make the case in four sentences.' },
]
