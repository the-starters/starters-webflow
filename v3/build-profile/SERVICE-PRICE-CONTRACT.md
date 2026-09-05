# Custom-service price input contract

Build and Edit profile accept JSON service prices only as strings or numbers.
Validate the JSON type before converting it to text. Arrays, booleans and objects
must fail before any profile request. In particular, `[100]` is not `100`, and
`[]` is not a request to remove a service.

After the type check, require whole-dollar USD values from 1 through 50000.
Numeric decimals remain invalid. Preserve the existing removal behavior for a
missing/null price or a blank/whitespace string. Valid integer numbers and
digit strings are sent as exact integer prices.

The regression runs the actual Build/Edit submit handlers for all three service
slots. It covers arrays (including nested and empty arrays), booleans, objects,
numeric decimals, accepted scalar boundaries, and null/blank removal.

```sh
node --test starter-edit-profile.test.js v3/build-profile/submit-writer-price-contract.test.js
```

This frontend contract does not replace independent validation in Xano's raw
request body. Production runtime and canonical no-write proof remain required.
