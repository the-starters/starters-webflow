// Read-only proof of the initial settled Checkout Session bound to an owned V3 intent.
// This endpoint sends no Meta event and never mutates membership or email state.
query "membership/checkout-receipt/v3" verb=POST {
  api_group = "V3.0 Starters"
  auth = "user_v3"

  input {
    text intent_key filters=trim
    text stripe_price_id filters=trim
  }

  stack {
    db.get user_v3 {
      field_name = "id"
      field_value = $auth.id
    } as $user

    precondition ($user != null) {
      error_type = "accessdenied"
      error = "V3 user required"
    }

    var $member_id {
      value = $user.memberstack_member_id|first_notempty:""
    }

    var $environment {
      value = $user.data_environment|first_notempty:""
    }

    var $origin {
      value = $env.$http_headers.Origin|first_notempty:($env.$http_headers.origin|first_notempty:"")|trim|to_lower
    }

    precondition (($member_id|starts_with:"mem_") && ($environment == "test" || $environment == "production") && (($member_id|starts_with:"mem_sb_") == ($environment == "test"))) {
      error_type = "accessdenied"
      error = "V3 member environment mismatch"
    }

    precondition (($environment == "test" && $origin == "https://the-starters-3-0.webflow.io") || ($environment == "production" && ($origin == "https://thestarters.com" || $origin == "https://www.thestarters.com"))) {
      error_type = "accessdenied"
      error = "V3 receipt origin mismatch"
    }

    precondition (("/^[a-f0-9]{64}$/"|regex_matches:$input.intent_key) && ($input.stripe_price_id == "prc_premium-monthly--fn1ae0qjj" || $input.stripe_price_id == "prc_paid-annual-2o5f040u")) {
      error_type = "inputerror"
      error = "Invalid V3 checkout identity"
    }

    db.get adminops_membership_checkout_intents_v3 {
      field_name = "intent_key"
      field_value = $input.intent_key
    } as $intent

    precondition ($intent != null) {
      error_type = "notfound"
      error = "Checkout intent unavailable"
    }

    var $now_seconds {
      value = now|format_timestamp:"U":"UTC"|to_int
    }

    precondition ($intent.user_v3_id == $auth.id && $intent.memberstack_member_id == $member_id && $intent.source_environment == $environment && $intent.memberstack_plan_id == "pln_new-paid-plan-463h04ph" && $intent.stripe_price_id == $input.stripe_price_id && $intent.created_at_seconds <= $now_seconds && $intent.expires_at_seconds >= $now_seconds && $intent.expires_at_seconds == ($intent.created_at_seconds|add:7200)) {
      error_type = "accessdenied"
      error = "Checkout intent ownership or expiry mismatch"
    }

    conditional {
      if ($intent.state == "pending") {
        return {
          value = {ok: true, status: "pending"}
        }
      }
    }

    precondition (($intent.state == "bound_pending_exclusion" || $intent.state == "verified") && ($intent.stripe_subscription_id|starts_with:"sub_") && ($intent.memberstack_connection_id|first_notempty:"") != "" && $intent.bound_at_seconds >= $intent.created_at_seconds && $intent.bound_at_seconds <= $intent.expires_at_seconds) {
      error_type = "accessdenied"
      error = "Checkout intent has no valid lifecycle binding"
    }

    db.get adminops_membership_subscription_snapshots_v3 {
      field_name = "stripe_subscription_id"
      field_value = $intent.stripe_subscription_id
    } as $snapshot

    conditional {
      if ($snapshot == null) {
        return {
          value = {ok: true, status: "pending"}
        }
      }
    }

    precondition ($snapshot.source_environment == $environment && $snapshot.memberstack_member_id == $member_id && $snapshot.memberstack_plan_id == $intent.memberstack_plan_id && $snapshot.memberstack_connection_id == $intent.memberstack_connection_id && $snapshot.stripe_price_id == $intent.stripe_price_id && $snapshot.active == true && ($snapshot.stripe_customer_id|starts_with:"cus_")) {
      error_type = "accessdenied"
      error = "Checkout subscription tuple mismatch"
    }

    var $stripe_key {
      value = $environment == "test" ? $env.stripe_secret_key_test : $env.stripe_secret_key_live
    }

    precondition (($stripe_key|first_notempty:"") != "") {
      error = "Stripe receipt verification is unavailable"
    }

    api.request {
      url = "https://api.stripe.com/v1/checkout/sessions"
      method = "GET"
      params = {
        subscription: $intent.stripe_subscription_id
        customer: $snapshot.stripe_customer_id
        status: "complete"
        "created[gte]": $intent.created_at_seconds
        "created[lte]": $intent.expires_at_seconds
        limit: 2
      }
      headers = ["Authorization: Bearer " ~ $stripe_key, "Stripe-Version: 2024-06-20"]
      timeout = 10
    } as $stripe_read

    precondition ($stripe_read.response.status == 200) {
      error = "Stripe receipt lookup failed"
    }

    var $sessions {
      value = $stripe_read.response.result.data|first_notnull:[]
    }

    conditional {
      if (($sessions|count) == 0) {
        return {
          value = {ok: true, status: "pending"}
        }
      }
    }

    precondition (($sessions|count) == 1 && $stripe_read.response.result.has_more == false) {
      error = "Checkout Session cardinality mismatch"
    }

    var $checkout {
      value = $sessions|first
    }

    conditional {
      if ($checkout.payment_status == "unpaid") {
        return {
          value = {ok: true, status: "pending"}
        }
      }
    }

    // Only zero-dollar receipts need an additional trial-versus-active check.
    var $subscription {
      value = null
    }

    conditional {
      if ($checkout.amount_total === 0) {
        api.request {
          url = "https://api.stripe.com/v1/subscriptions/" ~ $intent.stripe_subscription_id
          method = "GET"
          headers = ["Authorization: Bearer " ~ $stripe_key, "Stripe-Version: 2024-06-20"]
          timeout = 10
        } as $subscription_read

        precondition ($subscription_read.response.status == 200) {
          error = "Stripe subscription verification failed"
        }

        var.update $subscription {
          value = $subscription_read.response.result
        }
      }
    }

    function.run "membership/checkout_session_receipt_v3" {
      input = {
        intent: $intent
        snapshot: $snapshot
        checkout: $checkout
        subscription: $subscription
        source_environment: $environment
      }
    } as $receipt
  }

  response = $receipt
}
