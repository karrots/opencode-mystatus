# Subscription Quotas

MyStatus describes available usage across AI subscriptions, including when capacity resets or recovers.

## Language

**Quota**:
A provider-defined allowance for subscription usage. An allowance may be limited or explicitly unlimited.
_Avoid_: Balance (unless the allowance is monetary)

**Reset**:
The point when a quota's usage accounting restarts for a new allowance period. A reset is distinct from gradual restoration of capacity.
_Avoid_: Recovery

**Next recovery**:
The next point when some consumed capacity becomes available again under a provider's recovery rules.
_Avoid_: Reset, full recovery

**Full recovery**:
The provider-reported point when all consumed capacity is expected to become available again, assuming no further usage. A locally calculated estimate is not a reported full recovery.
_Avoid_: Reset, next recovery

**Unlimited quota**:
An allowance explicitly reported as having no usage cap. It does not mean quota information is missing.
_Avoid_: No quota data

**No quota data**:
A configured account has no reported quota information. This does not establish zero remaining capacity or an unlimited allowance.
_Avoid_: Exhausted, unlimited, unconfigured

**Quota query failure**:
An unsuccessful attempt to obtain quota information for a configured account or provider. A failure does not establish how much capacity remains.
_Avoid_: No quota data, exhausted

**Stale quota reading**:
A previously reported quota reading that has not been confirmed by a successful refresh after a refresh failure or its reported reset or recovery time has passed. Elapsed time alone does not establish a change in remaining capacity.
_Avoid_: Current quota, refreshed quota
