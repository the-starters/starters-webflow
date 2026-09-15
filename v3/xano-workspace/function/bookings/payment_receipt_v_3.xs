// INTERNAL read-only display enrichment. Failure must never undo or retry a successful booking.
// Resolve only the recorded booking snapshot; the Brand's current default is intentionally unused.
function "Bookings/payment_receipt_v3" {
  input {
    int booking_row_id
    text brand_memberstack_id filters=trim
    enum payment_environment {
      values = ["test", "live"]
    }
  }

  stack {
    var $receipt {
      value = {payment_method_id: null, payment_method: null}
    }

    try_catch {
      try {
        db.get nylas_bookings_v3 {
          field_name = "id"
          field_value = $input.booking_row_id
        } as $booking

        var $data_environment {
          value = $input.payment_environment == "test" ? "test" : "production"
        }

        precondition ($booking != null && ($booking.brand_data|get:"memberstack_id":"") == $input.brand_memberstack_id && $booking.payment_environment == $input.payment_environment && $booking.data_environment == $data_environment) {
          error_type = "accessdenied"
          error = "Booking payment receipt does not match its owner"
        }

        var $method_id {
          value = $booking.stripe_payment_method_id_snapshot|first_notempty:""
        }

        var $customer_id {
          value = $booking.stripe_customer_id_snapshot|first_notempty:""
        }

        conditional {
          if ($booking.paid_meeting && ($method_id|starts_with:"pm_") && ($method_id|strlen) <= 128 && ($customer_id|starts_with:"cus_")) {
            var.update $receipt {
              value = {payment_method_id: $method_id, payment_method: null}
            }

            function.run "Bookings/read_owned_card_v3" {
              input = {customer_id: $customer_id, payment_method_id: $method_id, payment_environment: $input.payment_environment}
            } as $card

            var.update $receipt {
              value = {payment_method_id: $method_id, payment_method: $card}
            }

          }
        }
      }
      catch {
        // Keep the verified snapshot ID if enrichment failed after authorization.
        // Missing display metadata is not a booking failure.
      }
    }
  }

  response = $receipt
}
