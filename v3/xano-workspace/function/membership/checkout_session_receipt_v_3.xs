// Validate one Stripe result already selected through authenticated intent ownership.
function "membership/checkout_session_receipt_v3" {
  input {
    json intent
    json snapshot
    json checkout
    json? subscription?
    enum source_environment {
      values = ["production", "test"]
    }
  }

  stack {
    var $intent {
      value = $input.intent
    }

    var $snapshot {
      value = $input.snapshot
    }

    var $checkout {
      value = $input.checkout
    }

    var $environment {
      value = $input.source_environment
    }

    precondition ($checkout.status == "complete" && $checkout.mode == "subscription" && $checkout.livemode == ($environment == "production") && $checkout.subscription == $intent.stripe_subscription_id && $checkout.customer == $snapshot.stripe_customer_id && $checkout.created >= $intent.created_at_seconds && $checkout.created <= $intent.expires_at_seconds && ($checkout.id|starts_with:($environment == "test" ? "cs_test_" : "cs_live_"))) {
      error = "Stripe Checkout Session binding mismatch"
    }

    var $fully_discounted {
      value = false
    }

    conditional {
      if ($checkout.amount_total === 0) {
        var $subscription {
          value = $input.subscription
        }

        precondition ($subscription !== null && $subscription.id == $intent.stripe_subscription_id && $subscription.customer == $snapshot.stripe_customer_id && $subscription.livemode == ($environment == "production") && $subscription.status == "active") {
          error = "Fully discounted checkout has no matching active subscription"
        }

        precondition (($checkout.payment_status == "paid" || $checkout.payment_status == "no_payment_required") && $checkout.amount_subtotal !== null && $checkout.amount_subtotal > 0 && $checkout.amount_subtotal === ($checkout.amount_subtotal|to_int) && $checkout.total_details.amount_discount === $checkout.amount_subtotal && $checkout.total_details.amount_tax === 0 && $checkout.total_details.amount_shipping === 0) {
          error = "Zero checkout has no verified full discount"
        }

        var.update $fully_discounted {
          value = true
        }
      }
    }

    precondition ($checkout.amount_total !== null && $checkout.amount_total >= 0 && $checkout.amount_total === ($checkout.amount_total|to_int) && $checkout.currency == "usd" && (($checkout.payment_status == "paid" && $checkout.amount_total > 0) || $fully_discounted)) {
      error = "Checkout has no supported settled amount"
    }

    var $receipt {
      value = {
        ok: true
        status: "paid"
        intent_key: $intent.intent_key
        stripe_price_id: $intent.stripe_price_id
        transaction_id: $checkout.id
        amount_total: $checkout.amount_total
        fully_discounted: $fully_discounted
        currency: "USD"
        source_environment: $environment
      }
    }
  }

  response = $receipt

  test "accept monthly payment" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": 29500, "currency": "usd"}, "source_environment": "production"}
    expect.to_equal ($response.amount_total) {
      value = 29500
    }
    expect.to_equal ($response.transaction_id) {
      value = "cs_live_owned"
    }
  }

  test "accept discounted payment" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": 22125, "currency": "usd"}, "source_environment": "production"}
    expect.to_equal ($response.amount_total) {
      value = 22125
    }
    expect.to_equal ($response.transaction_id) {
      value = "cs_live_owned"
    }
  }

  test "accept annual payment" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_paid-annual-2o5f040u", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": 234000, "currency": "usd"}, "source_environment": "production"}
    expect.to_equal ($response.amount_total) {
      value = 234000
    }
    expect.to_equal ($response.transaction_id) {
      value = "cs_live_owned"
    }
  }

  test "accept test payment" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_test_owned", "status": "complete", "mode": "subscription", "livemode": false, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": 29500, "currency": "usd"}, "source_environment": "test"}
    expect.to_equal ($response.amount_total) {
      value = 29500
    }
    expect.to_equal ($response.transaction_id) {
      value = "cs_test_owned"
    }
  }

  test "reject another subscription" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_other", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": 29500, "currency": "usd"}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject another customer" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_other", "created": 2000, "payment_status": "paid", "amount_total": 29500, "currency": "usd"}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject wrong Stripe mode" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": false, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": 29500, "currency": "usd"}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject earlier checkout" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 999, "payment_status": "paid", "amount_total": 29500, "currency": "usd"}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject late checkout" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 8201, "payment_status": "paid", "amount_total": 29500, "currency": "usd"}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject uncompleted session" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "open", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": 29500, "currency": "usd"}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject one-time payment" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "payment", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": 29500, "currency": "usd"}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject unpaid session" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "unpaid", "amount_total": 29500, "currency": "usd"}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject trial or free checkout" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd"}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject zero paid amount" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": 0, "currency": "usd"}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject negative amount" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": -1, "currency": "usd"}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject fractional cents" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": 1.5, "currency": "usd"}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject unsupported currency" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": 29500, "currency": "eur"}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject mode prefix mismatch" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_test_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": 29500, "currency": "usd"}, "source_environment": "production"}
    expect.to_throw
  }

  test "accept full discount with paid" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "paid", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "active"}}
    expect.to_equal ($response.amount_total) {
      value = 0
    }
    expect.to_equal ($response.fully_discounted) {
      value = true
    }
  }

  test "accept full discount with no_payment_required" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "active"}}
    expect.to_equal ($response.amount_total) {
      value = 0
    }
    expect.to_equal ($response.fully_discounted) {
      value = true
    }
  }

  test "reject discounted trial" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "trialing"}}
    expect.to_throw
  }

  test "reject discounted inactive subscription" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "canceled"}}
    expect.to_throw
  }

  test "reject discounted foreign subscription" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_other", "customer": "cus_owned", "livemode": true, "status": "active"}}
    expect.to_throw
  }

  test "reject discounted foreign customer" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_other", "livemode": true, "status": "active"}}
    expect.to_throw
  }

  test "reject discounted test subscription on live checkout" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": false, "status": "active"}}
    expect.to_throw
  }

  test "reject zero subtotal" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 0, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "active"}}
    expect.to_throw
  }

  test "reject fractional subtotal" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500.5, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "active"}}
    expect.to_throw
  }

  test "reject unpaid full discount" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "unpaid", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "active"}}
    expect.to_throw
  }

  test "reject full discount without Stripe subscription proof" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production"}
    expect.to_throw
  }

  test "reject zero with unsupported amount_discount" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29499, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "active"}}
    expect.to_throw
  }

  test "reject zero with unsupported amount_tax" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 1, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "active"}}
    expect.to_throw
  }

  test "reject zero with unsupported amount_shipping" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 1}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "active"}}
    expect.to_throw
  }

  test "accept full discount in test mode" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_test_discounted", "status": "complete", "mode": "subscription", "livemode": false, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "test", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": false, "status": "active"}}
    expect.to_equal ($response.amount_total) {
      value = 0
    }
    expect.to_equal ($response.fully_discounted) {
      value = true
    }
  }

  test "reject malformed amount_total None" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": null, "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "active"}}
    expect.to_throw
  }

  test "reject malformed amount_total 0" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": "0", "currency": "usd", "amount_subtotal": 29500, "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "active"}}
    expect.to_throw
  }

  test "reject malformed amount_subtotal 29500" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": "29500", "total_details": {"amount_discount": 29500, "amount_tax": 0, "amount_shipping": 0}}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "active"}}
    expect.to_throw
  }

  test "reject malformed total_details None" {
    input = {"intent": {"intent_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "stripe_price_id": "prc_premium-monthly--fn1ae0qjj", "stripe_subscription_id": "sub_owned", "created_at_seconds": 1000, "expires_at_seconds": 8200}, "snapshot": {"stripe_customer_id": "cus_owned"}, "checkout": {"id": "cs_live_owned", "status": "complete", "mode": "subscription", "livemode": true, "subscription": "sub_owned", "customer": "cus_owned", "created": 2000, "payment_status": "no_payment_required", "amount_total": 0, "currency": "usd", "amount_subtotal": 29500, "total_details": null}, "source_environment": "production", "subscription": {"id": "sub_owned", "customer": "cus_owned", "livemode": true, "status": "active"}}
    expect.to_throw
  }
}
