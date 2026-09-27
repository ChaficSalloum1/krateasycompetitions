export const operationalText=`Padel pairs.
30-minute matches; rest 10 minutes; 7 courts.
Start 2026-10-04T11:00:00+01:00; end 2026-10-04T20:00:00+01:00; timezone Europe/London.
Scoring: total games, no draws; tiebreak: wins, game difference, games won, manual.`;
export const examples={
  "Pools to cups":`Title: Sunday club championship
Open: 16 pairs; 4 pools of 4; top 1 per pool; best 2 runners-up; qualifiers to Konnect Cup; remaining to Tower Cup; protect 2 seeds; byes to highest seeds; avoid rematches.
${operationalText}`,
  "Knockout":`Title: Club knockout
Open: 8 pairs; single elimination; protect 2 seeds; byes to highest seeds; allow rematches.
${operationalText}`,
  "Round robin":`Title: Six-pair round robin
Open: 6 pairs; round robin.
${operationalText}`,
  "St Albans structure":`Title: St Albans structure study
Advanced: 12 pairs; pools 4,4,4; winners first to 4 places; compare by win percentage; qualifiers to Konnect Cup; remaining to Tower Cup; protect 2 seeds; byes to highest seeds; avoid rematches.
Intermediate: 23 pairs; pools 4,4,4,4,4,3; winners first to 4 places; compare by win percentage; qualifiers to Konnect Cup; remaining to Tower Cup; protect 2 seeds; byes to highest seeds; avoid rematches.
Beginners: 13 pairs; pools 4,3,3,3; winners first to 4 places; compare by win percentage; qualifiers to Konnect Cup; remaining to Tower Cup; protect 2 seeds; byes to highest seeds; avoid rematches.
${operationalText}`
};
// St Albans pool cardinalities derive from the repository planning candidate. Operational values
// here are explicit review-scenario inputs, not a reproduction of its detailed schedule or rules.
