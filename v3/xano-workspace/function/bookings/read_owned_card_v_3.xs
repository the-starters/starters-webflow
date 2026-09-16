// INTERNAL read-only Stripe adapter. Inputs must come from a server-authorized Brand or booking.
// A missing/unavailable summary is null, never a provider object or an exception.
function "Bookings/read_owned_card_v3" {
  input {
    text customer_id filters=trim
    text payment_method_id filters=trim
    enum payment_environment {
      values = ["test", "live"]
    }
  }

  stack {
    var $summary {
      value = null
    }

    try_catch {
      try {
        precondition (($input.customer_id|starts_with:"cus_") && ($input.payment_method_id|starts_with:"pm_") && ($input.payment_method_id|strlen) <= 128) {
          error_type = "inputerror"
          error = "Payment method identity is invalid"
        }

        api.request {
          url = "https://api.stripe.com/v1/customers/"
            |concat:($input.customer_id|url_encode):""
            |concat:"/payment_methods/":""
            |concat:($input.payment_method_id|url_encode):""
          method = "GET"
          headers = []
            |push:("Authorization: Bearer "|concat:($input.payment_environment == "test" ? $env.stripe_secret_key_test : $env.stripe_secret_key_live):"")
          timeout = 10
        } as $provider_method

        var $card {
          value = $provider_method.response.result
        }

        // Keep comparison operands separate so the importer preserves the mode check.
        var $provider_livemode {
          value = $card|get:"livemode":null
        }
        var $expected_livemode {
          value = $input.payment_environment == "live"
        }

        conditional {
          if ($provider_method.response.status == 200 && ($card|get:"id":"") == $input.payment_method_id && ($card|get:"customer":"") == $input.customer_id && ($provider_livemode|is_bool) && $provider_livemode == $expected_livemode && ($card|get:"type":"") == "card" && (($card|get:"card.last4":null)|is_text) && ("/^[0-9]{4}$/"|regex_matches:($card|get:"card.last4":""))) {
            var.update $summary {
              value = {id: $input.payment_method_id, last4: $card.card.last4, brand: $card.card.brand}
            }
          }
        }
      }
      catch {
        // Unavailable or malformed display metadata is deliberately represented as null.
      }
    }
  }

  response = $summary
}
