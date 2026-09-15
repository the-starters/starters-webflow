// INTERNAL V3 FUNCTION. The signed Nylas processor supplies provider identifiers and times;
// payment truth is derived from canonical Xano configuration and participant rows.
function "Bookings/upsert_from_nylas_v3" {
  input {
    text booking_id filters=trim
    text booking_ref filters=trim
    text config_id filters=trim
    text grant_id filters=trim
    timestamp start
    timestamp end
    text starter_memberstack_id filters=trim
    text brand_memberstack_id filters=trim
    text? nylas_request_id? filters=trim
    text? event_id? filters=trim
    text? meeting_link? filters=trim
    text? call_context? filters=trim
    text? unique_id? filters=trim
    json? participants?
    enum payment_environment {
      values = ["test", "live"]
    }

    int expected_configuration_revision
    int expected_amount_cents
    int expected_duration
    text? expected_destination_account? filters=trim
    text? expected_customer_id? filters=trim
    text? expected_payment_method_id? filters=trim
  }

  stack {
    precondition ($input.booking_id != "" && $input.booking_ref != "" && $input.config_id != "" && $input.grant_id != "" && $input.start < $input.end) {
      error_type = "inputerror"
      error = "Canonical Nylas booking identifiers and times are required"
    }

    var $expected_data_environment {
      value = $input.payment_environment == "test" ? "test" : "production"
    }

    db.get freelancers_v3 {
      field_name = "memberstack_id"
      field_value = $input.starter_memberstack_id
    } as $starter

    db.get brands_v3 {
      field_name = "memberstack_id"
      field_value = $input.brand_memberstack_id
    } as $brand

    precondition ($starter != null && $brand != null && ($starter.Email|first_notempty:"") != "" && ($brand.email_address|first_notempty:"") != "") {
      error_type = "notfound"
      error = "Canonical V3 booking participant was not found"
    }

    var $starter_email {
      value = ($starter.Email|first_notempty:"")|trim|to_lower
    }

    var $brand_email {
      value = ($brand.email_address|first_notempty:"")|trim|to_lower
    }

    precondition ($starter_email != "" && $brand_email != "" && $starter_email != $brand_email) {
      error_type = "inputerror"
      error = "Canonical Brand and Starter emails must be distinct"
    }

    precondition ((($input.participants|first_notempty:[])|count) <= 10) {
      error_type = "inputerror"
      error = "Guest participant list is too large"
    }

    var $guest_emails {
      value = []
    }

    foreach ($input.participants|first_notempty:[]) {
      each as $participant {
        var $guest_email {
          value = ($participant|get:"email":"")|to_text|trim|to_lower
        }

        precondition (($guest_email|strlen) > 3 && ($guest_email|strlen) <= 254 && ("/^[^ @]+@[^ @]+[.][^ @]+$/"|regex_matches:$guest_email)) {
          error_type = "inputerror"
          error = "Guest participant email is invalid"
        }

        array.has ($guest_emails) if ($this == $guest_email) as $guest_seen
        conditional {
          if ($guest_seen == false && $guest_email != $brand_email && $guest_email != $starter_email) {
            array.push $guest_emails {
              value = $guest_email
            }
          }
        }
      }
    }

    precondition (($guest_emails|count) <= 5) {
      error_type = "inputerror"
      error = "No more than five guest participants are allowed"
    }

    var.update $guest_emails {
      value = $guest_emails|sort:"":"text":true
    }

    var $guest_participants {
      value = []
    }

    foreach ($guest_emails) {
      each as $guest_email {
        array.push $guest_participants {
          value = {email: $guest_email}
        }
      }
    }

    db.get nylas_bookings_v3 {
      field_name = "booking_id"
      field_value = $input.booking_id
    } as $existing_booking

    var $booking {
      value = $existing_booking
    }

    var $created {
      value = false
    }

    conditional {
      if ($existing_booking == null) {
        db.get nylas_configurations_v3 {
          field_name = "config_id"
          field_value = $input.config_id
        } as $configuration

        precondition ($configuration != null && ($configuration.data_environment|first_notempty:"") == $expected_data_environment && $configuration.grant_id == $input.grant_id && $configuration.active && $configuration.sync_status == "ready" && $configuration.revision == $input.expected_configuration_revision && $configuration.price_cents == $input.expected_amount_cents && $configuration.duration == $input.expected_duration && ($configuration.is_paid == false || ($configuration.currency == "usd" && $configuration.price_cents >= 100 && $configuration.price_cents <= 100000 && ($configuration.price_cents|modulus:100) == 0 && $configuration.payment_environment == $input.payment_environment))) {
          error_type = "notfound"
          error = "Canonical V3 booking configuration was not found"
        }

        db.get availability_v3 {
          field_name = "nylas_grant_id"
          field_value = $input.grant_id
        } as $availability

        precondition ($availability != null && ($availability.data_environment|first_notempty:"") == $expected_data_environment && $availability.memberstack_id == $input.starter_memberstack_id) {
          error_type = "accessdenied"
          error = "Nylas grant does not belong to the canonical Starter"
        }

        precondition ($starter != null && $brand != null && $configuration.starter_id == $starter.id) {
          error_type = "notfound"
          error = "Canonical V3 booking participant was not found"
        }

        db.get user_v3 {
          field_name = "memberstack_member_id"
          field_value = $input.starter_memberstack_id
        } as $starter_user

        db.get user_v3 {
          field_name = "memberstack_member_id"
          field_value = $input.brand_memberstack_id
        } as $brand_user

        var $starter_is_test_member {
          value = $input.starter_memberstack_id|starts_with:"mem_sb_"
        }

        var $brand_is_test_member {
          value = $input.brand_memberstack_id|starts_with:"mem_sb_"
        }

        var $starter_is_live_member {
          value = ($input.starter_memberstack_id|starts_with:"mem_") && $starter_is_test_member == false
        }

        var $brand_is_live_member {
          value = ($input.brand_memberstack_id|starts_with:"mem_") && $brand_is_test_member == false
        }

        precondition ($starter_user != null && $brand_user != null && ($starter_user.data_environment|first_notempty:"") == $expected_data_environment && ($brand_user.data_environment|first_notempty:"") == $expected_data_environment && (($expected_data_environment == "test" && $starter_is_test_member && $brand_is_test_member) || ($expected_data_environment == "production" && $starter_is_live_member && $brand_is_live_member))) {
          error_type = "accessdenied"
          error = "Booking participants do not match the canonical environment"
        }

        var $brand_customer {
          value = $input.payment_environment == "test" ? $brand.stripe_customer_id_test : $brand.stripe_customer_id_live
        }

        var $brand_payment_method {
          value = $input.payment_environment == "test" ? $brand.stripe_payment_method_test : $brand.stripe_payment_method_live
        }

        var $brand_readiness {
          value = $input.payment_environment == "test" ? $brand.stripe_payment_readiness_test : $brand.stripe_payment_readiness_live
        }

        var $brand_readiness_synced_at {
          value = $input.payment_environment == "test" ? $brand.stripe_payment_last_synced_at_test : $brand.stripe_payment_last_synced_at_live
        }

        var $starter_connect_id {
          value = $input.payment_environment == "test" ? ($starter.stripe_connect_id_test|first_notempty:"") : ($starter.stripe_connect_id|first_notempty:"")
        }

        var $starter_charges_enabled {
          value = $input.payment_environment == "test" ? ($starter.stripe_charges_enabled_test|first_notempty:false) : ($starter.stripe_charges_enabled|first_notempty:false)
        }

        var $starter_connect_synced_at {
          value = $input.payment_environment == "test" ? $starter.stripe_connect_synced_at_test : $starter.stripe_connect_synced_at
        }

        // The booking command records the reviewed card under the Brand row lock before
        // calling Nylas. A later account-default change cannot replace that booking choice.
        var $payment_claim {
          value = null
        }

        conditional {
          if (($input.unique_id|first_notempty:"") != "") {
            db.get adminops_booking_commands_v3 {
              field_name = "idempotency_key"
              field_value = $input.unique_id
            } as $payment_claim_command

            var.update $payment_claim {
              value = $payment_claim_command
            }
          }
        }

        var $has_payment_claim {
          value = ($payment_claim|get:"safe_result.claimed_payment_method_id":"") != ""
        }

        var $valid_payment_claim {
          value = $has_payment_claim && $payment_claim.command_type == "booking_request" && $payment_claim.actor_memberstack_id == $input.brand_memberstack_id && $payment_claim.data_environment == $expected_data_environment && $payment_claim.configuration_id == $input.config_id && $payment_claim.booking_id == $input.booking_id && $payment_claim.status == "reconciliation_required" && ($payment_claim.safe_result|get:"claimed_customer_id":"") == $input.expected_customer_id && ($payment_claim.safe_result|get:"claimed_payment_method_id":"") == $input.expected_payment_method_id && ($payment_claim.safe_result|get:"claimed_payment_method.id":"") == $input.expected_payment_method_id
        }

        conditional {
          if ($configuration.is_paid) {
            precondition ($configuration.price_cents >= 100 && $configuration.price_cents <= 100000 && ($configuration.price_cents|modulus:100) == 0 && $starter_connect_id != "" && $starter_charges_enabled && $starter_connect_synced_at != null && $starter_connect_synced_at >= (now|add_ms_to_timestamp:-86400000)) {
              error_type = "inputerror"
              error = "Starter paid consultation is not charge-ready"
            }

            precondition ($brand_customer != null && $brand_customer != "" && ($valid_payment_claim || ($has_payment_claim == false && $brand_payment_method != null && $brand_payment_method != "" && $brand_readiness == "ready" && $brand_readiness_synced_at != null && $brand_readiness_synced_at >= (now|add_ms_to_timestamp:-86400000)))) {
              error_type = "inputerror"
              error = "Brand payment method is not ready"
            }

            precondition ($starter_connect_id == $input.expected_destination_account && $brand_customer == $input.expected_customer_id && ($has_payment_claim ? $valid_payment_claim : ($brand_payment_method == $input.expected_payment_method_id))) {
              error_type = "inputerror"
              error = "Paid consultation identity changed while the booking was being created"
            }
          }
        }

        var $insert_error {
          value = null
        }

        var $confirmation_deadline {
          value = now|add_secs_to_timestamp:86400
        }

        conditional {
          if ($confirmation_deadline >= ($input.start|add_ms_to_timestamp:-3600000)) {
            var.update $confirmation_deadline {
              value = $input.start|add_ms_to_timestamp:-3600000
            }
          }
        }

        try_catch {
          try {
            db.add nylas_bookings_v3 {
              data = {
                from_stage                       : $input.payment_environment == "test"
                data_environment                 : $expected_data_environment
                updated_at                       : now
                lifecycle_revision               : 1
                confirmation_expires_at          : $confirmation_deadline
                status                           : "pending"
                from_pending                     : true
                payment_status                   : $configuration.is_paid ? "waiting_for_intent" : null
                payment_intent                   : null
                paid_meeting                     : $configuration.is_paid
                pm_confirmed                     : $configuration.is_paid ? true : false
                currency                         : "usd"
                payment_environment              : $input.payment_environment
                amount_cents                     : $input.expected_amount_cents
                stripe_destination_account       : ($configuration.is_paid ? $input.expected_destination_account : null)
                stripe_customer_id_snapshot      : ($configuration.is_paid ? $input.expected_customer_id : null)
                stripe_payment_method_id_snapshot: ($configuration.is_paid ? $input.expected_payment_method_id : null)
                payment_revision                 : 0
                payment_policy_version           : "v3-paid-call-2026-08-10"
                payment_reconciliation_status    : $configuration.is_paid ? "ready" : null
                duration                         : $input.expected_duration
                price                            : $configuration.price
                start                            : $input.start
                end                              : $input.end
                meeting_link                     : $input.meeting_link|first_notempty:""
                starter_data                     : {
                id            : $starter.id
                memberstack_id: $starter.memberstack_id
                email         : $starter_email
                name          : $starter.Name
                timezone      : $availability.timezone
              }
                brand_data                       : {
                id            : $brand.id
                memberstack_id: $brand.memberstack_id
                email         : $brand_email
                name          : $brand.full_name
              }
                another_participants             : $guest_participants
                call_context                     : $input.call_context|first_notempty:""
                booking_id                       : $input.booking_id
                grant_id                         : $input.grant_id
                booking_ref                      : $input.booking_ref
                config_id                        : $input.config_id
                event_id                         : $input.event_id|first_notempty:""
                nylas_request_id                 : $input.nylas_request_id|first_notempty:""
                unique_id                        : $input.unique_id|first_notempty:""
              }
            } as $new_booking

            var.update $booking {
              value = $new_booking
            }

            var.update $created {
              value = true
            }
          }

          catch {
            var.update $insert_error {
              value = $error[""]
            }
          }
        }

        conditional {
          if ($insert_error != null) {
            db.get nylas_bookings_v3 {
              field_name = "booking_id"
              field_value = $input.booking_id
            } as $race_winner

            precondition ($race_winner != null && $race_winner.config_id == $input.config_id && ($race_winner.starter_data|get:"memberstack_id":"") == $input.starter_memberstack_id && ($race_winner.brand_data|get:"memberstack_id":"") == $input.brand_memberstack_id && (($race_winner.starter_data|get:"email":"")|trim|to_lower) == $starter_email && (($race_winner.brand_data|get:"email":"")|trim|to_lower) == $brand_email && ($race_winner.another_participants|first_notempty:[]) == $guest_participants) {
              error_type = "inputerror"
              error = "Booking insert failed without a matching idempotency winner"
            }

            var.update $booking {
              value = $race_winner
            }
          }
        }
      }

      else {
        precondition ($existing_booking.config_id == $input.config_id && $existing_booking.grant_id == $input.grant_id && $existing_booking.booking_ref == $input.booking_ref && $existing_booking.start == $input.start && $existing_booking.end == $input.end && ($existing_booking.data_environment|first_notempty:"") == $expected_data_environment && $existing_booking.payment_environment == $input.payment_environment && $existing_booking.amount_cents == $input.expected_amount_cents && $existing_booking.duration == $input.expected_duration && ($existing_booking.starter_data|get:"memberstack_id":"") == $input.starter_memberstack_id && ($existing_booking.brand_data|get:"memberstack_id":"") == $input.brand_memberstack_id && (($existing_booking.starter_data|get:"email":"")|trim|to_lower) == $starter_email && (($existing_booking.brand_data|get:"email":"")|trim|to_lower) == $brand_email && ($existing_booking.another_participants|first_notempty:[]) == $guest_participants && ($existing_booking.paid_meeting == false || ($existing_booking.stripe_destination_account == $input.expected_destination_account && $existing_booking.stripe_customer_id_snapshot == $input.expected_customer_id && $existing_booking.stripe_payment_method_id_snapshot == $input.expected_payment_method_id))) {
          error_type = "inputerror"
          error = "Booking ID is already bound to different canonical inputs"
        }
      }
    }
  }

  response = {
    booking_id  : $booking.booking_id
    row_id      : $booking.id
    status      : $booking.status
    created     : $created
    duplicate   : ($created == false)
    amount_cents: $booking.amount_cents
    currency    : $booking.currency
    duration    : $booking.duration
    guest_count : ($booking.another_participants|first_notempty:[])|count
  }

  history = 100
  guid = "Ima6C0ayn62TPiYL5w5kM2vLglA"
}
