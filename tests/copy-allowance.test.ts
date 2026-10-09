import { test } from "node:test"
import assert from "node:assert/strict"
import { copyAllowance, copyAllowanceProblem, copyAllowanceText } from "@/lib/plan-allowance"

// What a plan includes of Copy Trading: Essential one Copy Group of two
// accounts; Pro up to three Copy Groups and fifteen accounts in total across
// them — a single group may use all fifteen. The Leader is one of a group's
// accounts.

test("each plan's allowance, in numbers and in words", () => {
  assert.deepEqual(copyAllowance(false), { plan: "essential", groups: 1, accounts: 2 })
  assert.deepEqual(copyAllowance(true), { plan: "pro", groups: 3, accounts: 15 })
  assert.equal(copyAllowanceText(copyAllowance(false)), "1 Copy Group of up to 2 accounts (a Leader and 1 Follower)")
  assert.equal(copyAllowanceText(copyAllowance(true)), "up to 3 Copy Groups and 15 accounts in total")
})

test("a group is made only while there is one left in the plan, and within the accounts it includes", () => {
  const essential = copyAllowance(false)
  const pro = copyAllowance(true)
  // Essential: the first group, a Leader and one Follower
  assert.equal(copyAllowanceProblem(essential, { groups: 0, accounts: { want: 2 } }), null)
  assert.match(copyAllowanceProblem(essential, { groups: 1, accounts: { want: 2 } })!, /Essential includes 1 Copy Group\. Delete one to make another\. Upgrade to Pro at \/pricing for up to 3 Copy Groups and 15 accounts in total/)
  assert.match(copyAllowanceProblem(essential, { groups: 0, accounts: { want: 3 } })!, /up to 2 accounts in a Copy Group: a Leader and 1 Follower\. Upgrade to Pro/)
  // Pro: three groups; the fifteen accounts are a total across them, so a single group may hold all fifteen
  assert.equal(copyAllowanceProblem(pro, { groups: 2, accounts: { want: 15 } }), null)
  assert.equal(copyAllowanceProblem(pro, { groups: 3, accounts: { want: 2 } }), "Pro includes 3 Copy Groups. Delete one to make another.")
  assert.equal(copyAllowanceProblem(pro, { groups: 0, accounts: { want: 16 } }), "Pro includes up to 15 accounts in total across your Copy Groups.")
})

test("the fifteen Pro accounts are a single total across every group", () => {
  const pro = copyAllowance(true)
  // ten in use elsewhere, five more fits exactly; the sixteenth does not
  assert.equal(copyAllowanceProblem(pro, { accounts: { want: 15, had: 10 } }), null)
  assert.equal(copyAllowanceProblem(pro, { accounts: { want: 16, had: 10 } }), "Pro includes up to 15 accounts in total across your Copy Groups.")
  // once the total is reached, no other group can take another
  assert.equal(copyAllowanceProblem(pro, { accounts: { want: 15, had: 15 } }), null)
  assert.equal(copyAllowanceProblem(pro, { accounts: { want: 16, had: 15 } }), "Pro includes up to 15 accounts in total across your Copy Groups.")
})

test("what a group already has beyond the plan is kept; it takes no more, and is not switched on as it is", () => {
  const essential = copyAllowance(false)
  // a group made on Pro, now on Essential: its three followers may be kept and their settings changed
  assert.equal(copyAllowanceProblem(essential, { accounts: { want: 4, had: 4 } }), null)
  assert.equal(copyAllowanceProblem(essential, { accounts: { want: 3, had: 4 } }), null)
  // another is not taken
  assert.match(copyAllowanceProblem(essential, { accounts: { want: 5, had: 4 } })!, /up to 2 accounts/)
  // switching on: within the plan, whatever the group had
  assert.match(copyAllowanceProblem(essential, { groups: 0, accounts: { want: 4 }, switchingOn: true })!, /Remove a Follower from this group to switch it on\./)
  assert.match(copyAllowanceProblem(essential, { groups: 1, accounts: { want: 2 }, switchingOn: true })!, /Essential includes 1 Copy Group copying at a time\. Pause the other one first\./)
  assert.match(copyAllowanceProblem(copyAllowance(true), { groups: 3, accounts: { want: 2 }, switchingOn: true })!, /Pro includes 3 Copy Groups copying at a time\. Pause one of the others first\.$/)
  // a single Pro group of all fifteen accounts switches on
  assert.equal(copyAllowanceProblem(copyAllowance(true), { groups: 2, accounts: { want: 15 }, switchingOn: true }), null)
})
