// Authenticated Brand booking command for /hire/<slug>. The server checks the exact slot again,
// creates a short-lived private Scheduler session, books with Nylas, then writes one V3 row.
query "brand/booking/request/v3" verb=POST {
  api_group = "Scheduling Calls In-App"
  auth = "user_v3"

  input {
    text starter_slug filters=trim
    text config_id filters=trim
    timestamp start
    timestamp end
    text timezone filters=trim
    text? topic? filters=trim
    text? context? filters=trim
    json? guest_emails?
    text? expected_payment_method_id? filters=trim
    text idempotency_key filters=trim
  }

  stack {
    db.get user_v3 {
      field_name = "id"
      field_value = $auth.id
    } as $auth_user
  
    var $brand_member_id {
      value = $auth_user|get:"memberstack_member_id":""
    }
  
    var $request_origin {
      value = $env.$http_headers.Origin
        |first_notempty:($env.$http_headers.origin|first_notempty:"")
        |trim
        |to_lower
    }
  
    var $is_test_member {
      value = $brand_member_id|starts_with:"mem_sb_"
    }
  
    var $is_live_member {
      value = ($brand_member_id|starts_with:"mem_") && $is_test_member == false
    }
  
    precondition ($is_test_member || $is_live_member) {
      error_type = "accessdenied"
      error = "Paid-call authenticated member mode is invalid"
    }
  
    var $member_environment {
      value = $is_test_member ? "test" : "live"
    }
  
    var $origin_environment {
      value = ""
    }
  
    conditional {
      if ($request_origin == "https://the-starters-3-0.webflow.io") {
        var.update $origin_environment {
          value = "test"
        }
      }
    
      elseif ($request_origin == "https://thestarters.com" || $request_origin == "https://www.thestarters.com") {
        var.update $origin_environment {
          value = "live"
        }
      }
    }
  
    precondition ($origin_environment != "" && $member_environment == $origin_environment) {
      error_type = "accessdenied"
      error = "Paid-call member environment does not match the request origin"
    }
  
    var $expected_data_environment {
      value = $member_environment == "test" ? "test" : "production"
    }
  
    var $nylas_auth_header {
      value = $expected_data_environment == "test" ? $env.nylas_auth_header_v3_test : $env.nylas_auth_header_v3_production
    }
  
    precondition (($nylas_auth_header|first_notempty:"") != "") {
      error = "Paid-call Nylas credential is not configured for this environment"
    }
  
    precondition (($auth_user.data_environment|first_notempty:"") == $expected_data_environment) {
      error_type = "accessdenied"
      error = "Paid-call user environment does not match the authenticated member mode"
    }
  
    var $payment_environment {
      value = $member_environment
    }
  
    precondition ($payment_environment == "test" || $payment_environment == "live") {
      error = "V3 paid-call payment environment is not configured"
    }
  
    precondition (($input.timezone|strlen) > 0 && ($input.timezone|strlen) <= 100) {
      error_type = "inputerror"
      error = "Booking timezone is invalid"
    }
  
    precondition ($input.start > now && ($input.starter_slug|strlen) > 0 && ($input.starter_slug|strlen) <= 200 && ($input.config_id|strlen) > 0 && ($input.config_id|strlen) <= 200 && (($input.topic|first_notempty:"")|strlen) <= 200 && (($input.context|first_notempty:"")|strlen) <= 2000) {
      error_type = "inputerror"
      error = "Booking details are invalid"
    }
  
    db.get brands_v3 {
      field_name = "memberstack_id"
      field_value = $brand_member_id
    } as $brand
  
    db.get freelancers_v3 {
      field_name = "webflow_slug_30"
      field_value = $input.starter_slug
    } as $starter
  
    db.get nylas_configurations_v3 {
      field_name = "config_id"
      field_value = $input.config_id
    } as $configuration
  
    precondition ($brand != null && $starter != null && $configuration != null && $configuration.starter_id == $starter.id && $input.start < $input.end && $input.idempotency_key != "" && ($input.idempotency_key|strlen) <= 128 && $brand.full_name != null && $brand.full_name != "" && $brand.email_address != null && $brand.email_address != "") {
      error_type = "notfound"
      error = "Bookable service was not found"
    }
  
    precondition ((($input.guest_emails|first_notempty:[])|count) <= 10) {
      error_type = "inputerror"
      error = "Guest email list is too large"
    }
  
    var $guest_emails {
      value = []
    }
  
    foreach ($input.guest_emails|first_notempty:[]) {
      each as $guest_email_input {
        var $guest_email {
          value = $guest_email_input
            |to_text
            |trim
            |to_lower
        }
      
        precondition (($guest_email|strlen) > 3 && ($guest_email|strlen) <= 254 && ("/^[^ @]+@[^ @]+[.][^ @]+$/"|regex_matches:$guest_email)) {
          error_type = "inputerror"
          error = "Guest email is invalid"
        }
      
        array.has ($guest_emails) if ($this == $guest_email) as $guest_seen
        conditional {
          if ($guest_seen == false && $guest_email != ($brand.email_address|trim|to_lower) && $guest_email != ($starter.Email|trim|to_lower)) {
            array.push $guest_emails {
              value = $guest_email
            }
          }
        }
      }
    }
  
    precondition (($guest_emails|count) <= 5) {
      error_type = "inputerror"
      error = "No more than five guest emails are allowed"
    }
  
    var.update $guest_emails {
      value = $guest_emails|sort:"":"text":true
    }
  
    var $guest_participants {
      value = []
    }
  
    var $guest_fingerprint {
      value = ""
    }
  
    foreach ($guest_emails) {
      each as $guest_email {
        array.push $guest_participants {
          value = {email: $guest_email}
        }
      
        var.update $guest_fingerprint {
          value = $guest_fingerprint
            |concat:"|":""
            |concat:$guest_email:""
        }
      }
    }
  
    db.get user_v3 {
      field_name = "memberstack_member_id"
      field_value = $starter.memberstack_id
    } as $starter_user
  
    precondition ($starter_user != null && ($starter_user.data_environment|first_notempty:"") == $expected_data_environment && (($expected_data_environment == "test" && ($starter.memberstack_id|starts_with:"mem_sb_")) || ($expected_data_environment == "production" && ($starter.memberstack_id|starts_with:"mem_") && ($starter.memberstack_id|starts_with:"mem_sb_") == false)) && ($configuration.data_environment|first_notempty:"") == $expected_data_environment && $configuration.starter_memberstack_id == $starter.memberstack_id) {
      error_type = "accessdenied"
      error = "Bookable service does not match the authenticated environment"
    }
  
    precondition (($input.end|subtract:$input.start) == (($configuration.duration|multiply:60)|multiply:1000)) {
      error_type = "inputerror"
      error = "Selected slot does not match the service duration"
    }
  
    var $brand_customer {
      value = $payment_environment == "test" ? $brand.stripe_customer_id_test : $brand.stripe_customer_id_live
    }
  
    var $brand_payment_method {
      value = $payment_environment == "test" ? $brand.stripe_payment_method_test : $brand.stripe_payment_method_live
    }
  
    var $brand_readiness {
      value = $payment_environment == "test" ? $brand.stripe_payment_readiness_test : $brand.stripe_payment_readiness_live
    }
  
    var $brand_readiness_synced_at {
      value = $payment_environment == "test" ? $brand.stripe_payment_last_synced_at_test : $brand.stripe_payment_last_synced_at_live
    }
  
    var $starter_connect_id {
      value = $payment_environment == "test" ? ($starter.stripe_connect_id_test|first_notempty:"") : ($starter.stripe_connect_id|first_notempty:"")
    }
  
    var $starter_charges_enabled {
      value = $payment_environment == "test" ? ($starter.stripe_charges_enabled_test|first_notempty:false) : ($starter.stripe_charges_enabled|first_notempty:false)
    }
  
    var $starter_connect_synced_at {
      value = $payment_environment == "test" ? $starter.stripe_connect_synced_at_test : $starter.stripe_connect_synced_at
    }
  
    var $reviewed_payment_method {
      value = $input.expected_payment_method_id|first_notempty:""
    }

    precondition ($reviewed_payment_method == "" || (($reviewed_payment_method|starts_with:"pm_") && ($reviewed_payment_method|strlen) <= 128)) {
      error_type = "inputerror"
      error = "Selected payment method is invalid"
    }

    var $fingerprint {
      value = $brand_member_id
        |concat:"|":""
        |concat:$starter.memberstack_id:""
        |concat:"|":""
        |concat:$configuration.config_id:""
        |concat:"|":""
        |concat:($input.start|to_text):""
        |concat:"|":""
        |concat:($input.end|to_text):""
        |concat:"|":""
        |concat:$input.timezone:""
        |concat:"|":""
        |concat:($input.topic|first_notempty:""):""
        |concat:"|":""
        |concat:($input.context|first_notempty:""):""
        |concat:"|":""
        |concat:$payment_environment:""
        |concat:"|":""
        |concat:$guest_fingerprint:""
    }
  
    // Preserve existing clients' fingerprints. New choices bind their own command identity.
    conditional {
      if ($configuration.is_paid && $reviewed_payment_method != "") {
        var.update $fingerprint {
          value = $fingerprint|concat:"|payment_method=":""|concat:$reviewed_payment_method:""
        }
      }
    }

    var.update $fingerprint {
      value = $fingerprint|sha256
    }

    db.get adminops_booking_commands_v3 {
      field_name = "idempotency_key"
      field_value = $input.idempotency_key
    } as $existing_command
  
    precondition ($existing_command == null || ($existing_command.command_type == "booking_request" && $existing_command.actor_memberstack_id == $brand_member_id && $existing_command.configuration_id == $configuration.config_id && $existing_command.request_fingerprint == $fingerprint)) {
      error_type = "inputerror"
      error = "Idempotency key is already bound to a different booking request"
    }
  
    var $duplicate {
      value = $existing_command != null && $existing_command.status == "completed" && ($existing_command.data_environment|first_notempty:"") == $expected_data_environment
    }
  
    // Existing commands may be read back after the service is switched Off.
    // Fresh requests still require an active service, then recheck under the claim lock.
    precondition ($existing_command != null || ($configuration.active && $configuration.sync_status == "ready")) {
      error_type = "notfound"
      error = "Bookable service was not found"
    }
  
    var $terminal_failure {
      value = $existing_command != null && $existing_command.status == "failed" && ($existing_command.data_environment|first_notempty:"") == $expected_data_environment
    }
  
    var $reconciliation_retry {
      value = $existing_command != null && $existing_command.status == "reconciliation_required"
    }
  
    precondition ($existing_command == null || $duplicate || $terminal_failure || $reconciliation_retry) {
      error_type = "inputerror"
      error = "Booking request is pending reconciliation"
    }
  
    precondition ($terminal_failure == false) {
      error_type = "inputerror"
      error = "This booking request previously failed; use a new idempotency key"
    }
  
    var $result {
      value = $existing_command|get:"safe_result":null
    }
  
    var $recovered {
      value = false
    }
  
    conditional {
      if ($reconciliation_retry) {
        db.get nylas_bookings_v3 {
          field_name = "unique_id"
          field_value = $input.idempotency_key
        } as $recovery_booking
      
        precondition ($recovery_booking != null) {
          error_type = "inputerror"
          error = "Canonical booking reconciliation is not ready"
        }
      
        var $command_environment {
          value = $existing_command.data_environment|first_notempty:""
        }
      
        var $legacy_null_environment {
          value = $command_environment == ""
        }
      
        precondition (($command_environment == $expected_data_environment || $legacy_null_environment) && $existing_command.command_type == "booking_request" && $existing_command.actor_memberstack_id == $brand_member_id && $existing_command.configuration_id == $configuration.config_id && $existing_command.request_fingerprint == $fingerprint && (($existing_command|get:"booking_id":"") == "" || $existing_command.booking_id == $recovery_booking.booking_id) && (($existing_command|get:"provider_request_id":"") == "" || $existing_command.provider_request_id == $recovery_booking.nylas_request_id) && ($recovery_booking.data_environment|first_notempty:"") == $expected_data_environment && $recovery_booking.unique_id == $input.idempotency_key && $recovery_booking.config_id == $configuration.config_id && $recovery_booking.grant_id == $configuration.grant_id && ($recovery_booking.starter_data|get:"memberstack_id":"") == $starter.memberstack_id && ($recovery_booking.brand_data|get:"memberstack_id":"") == $brand.memberstack_id && ($recovery_booking.another_participants|first_notempty:[]) == $guest_participants && $recovery_booking.start == $input.start && $recovery_booking.end == $input.end && $recovery_booking.call_context == ($input.context|first_notempty:"") && $recovery_booking.amount_cents == $configuration.price_cents && $recovery_booking.duration == $configuration.duration && $recovery_booking.paid_meeting == $configuration.is_paid && $recovery_booking.payment_environment == $payment_environment && $recovery_booking.currency == $configuration.currency && $recovery_booking.payment_revision == 0 && $recovery_booking.status == "pending" && $recovery_booking.from_pending) {
          error_type = "accessdenied"
          error = "Booking reconciliation does not match the authenticated request"
        }
      
        conditional {
          if ($configuration.is_paid) {
            precondition ($recovery_booking.payment_status == "waiting_for_intent" && $recovery_booking.stripe_destination_account == $starter_connect_id && $recovery_booking.stripe_customer_id_snapshot == $brand_customer && $recovery_booking.stripe_payment_method_id_snapshot == ($reviewed_payment_method != "" ? $reviewed_payment_method : $brand_payment_method)) {
              error_type = "accessdenied"
              error = "Paid booking reconciliation snapshot does not match"
            }
          }
        
          else {
            precondition (($recovery_booking.stripe_destination_account|first_notempty:"") == "" && ($recovery_booking.stripe_customer_id_snapshot|first_notempty:"") == "" && ($recovery_booking.stripe_payment_method_id_snapshot|first_notempty:"") == "") {
              error_type = "accessdenied"
              error = "Free booking reconciliation snapshot does not match"
            }
          }
        }
      
        var.update $result {
          value = {
            booking_id  : $recovery_booking.booking_id
            row_id      : $recovery_booking.id
            status      : $recovery_booking.status
            config_id   : $recovery_booking.config_id
            start       : $recovery_booking.start
            end         : $recovery_booking.end
            paid        : $recovery_booking.paid_meeting
            amount_cents: $recovery_booking.amount_cents
            currency    : $recovery_booking.currency
            guest_count : ($recovery_booking.another_participants|first_notempty:[])|count
          }
        }
      
        function.run "Bookings/payment_receipt_v3" {
          input = {booking_row_id: $recovery_booking.id, brand_memberstack_id: $brand_member_id, payment_environment: $payment_environment}
        } as $recovery_payment_receipt

        var.update $result {
          value = $result|set:"payment_method_id":($recovery_payment_receipt|get:"payment_method_id":null)|set:"payment_method":($recovery_payment_receipt|get:"payment_method":null)
        }

        // The one legacy TEST command predates the environment column. Stamp it atomically with
        // completion only after Origin, member pool, both user rows, configuration, fingerprint,
        // and canonical booking match.
        db.edit adminops_booking_commands_v3 {
          field_name = "id"
          field_value = $existing_command.id
          data = {
            data_environment   : $expected_data_environment
            updated_at         : now
            booking_id         : $recovery_booking.booking_id
            provider_request_id: $recovery_booking.nylas_request_id
            status             : "completed"
            safe_result        : $result
            last_error         : null
          }
        } as $completed_recovery_command
      
        var.update $duplicate {
          value = true
        }
      
        var.update $recovered {
          value = true
        }
      }
    }
  
    conditional {
      if ($duplicate == false && $recovered == false) {
        // A public Brand booking must not depend on the Starter opening their dashboard within the
        // previous 24 hours. Refresh stale Connect evidence from Stripe at the booking boundary, then
        // keep the existing fail-closed readiness gate below.
        var $starter_connect_fresh {
          value = $starter_connect_synced_at != null && $starter_connect_synced_at >= (now|add_ms_to_timestamp:-86400000)
        }
  
        conditional {
          if ($configuration.is_paid && $starter_connect_id != "" && $starter_connect_fresh == false) {
            function.run "Bookings/sync_starter_connect_readiness_v3" {
              input = {
                stripe_connect_id : $starter_connect_id
                stripe_environment: $payment_environment
              }
            } as $starter_connect_refresh
      
            precondition ($starter_connect_refresh.starter_id == $starter.id && $starter_connect_refresh.stripe_environment == $payment_environment && $starter_connect_refresh.connected && $starter_connect_refresh.synced_at != null) {
              error_type = "accessdenied"
              error = "Starter Connect refresh does not match the bookable service"
            }
      
            var.update $starter_charges_enabled {
              value = $starter_connect_refresh.paid_call_ready
            }
      
            var.update $starter_connect_synced_at {
              value = $starter_connect_refresh.synced_at
            }
          }
        }
  
        conditional {
          if ($configuration.is_paid) {
            precondition ($configuration.payment_environment == $payment_environment && $configuration.price_cents >= 100 && $configuration.price_cents <= 100000 && ($configuration.price_cents|modulus:100) == 0 && $configuration.currency == "usd" && $starter_connect_id != "" && $starter_charges_enabled && $starter_connect_synced_at != null && $starter_connect_synced_at >= (now|add_ms_to_timestamp:-86400000) && $brand_customer != null && $brand_customer != "" && $brand_payment_method != null && $brand_payment_method != "" && $brand_readiness == "ready" && $brand_readiness_synced_at != null && $brand_readiness_synced_at >= (now|add_ms_to_timestamp:-86400000)) {
              error_type = "inputerror"
              error = "Paid consultation payment readiness is incomplete"
            }
          }
        }
  

        var $reviewed_card {
          value = null
        }

        conditional {
          if ($configuration.is_paid && $reviewed_payment_method != "") {
            function.run "Bookings/read_owned_card_v3" {
              input = {customer_id: $brand_customer, payment_method_id: $reviewed_payment_method, payment_environment: $payment_environment}
            } as $verified_reviewed_card

            precondition ($verified_reviewed_card != null) {
              error_type = "inputerror"
              error = "Selected payment method is unavailable. Review your card and try again."
            }

            var.update $reviewed_card {
              value = $verified_reviewed_card
            }
          }
        }

        var $command {
          value = null
        }
      
        // Serialize booking intent with service update and disable. Provider calls remain outside
        // this short transaction. Service mutations use the same configuration-row lock.
        db.transaction {
          stack {
            db.get nylas_configurations_v3 {
              field_name = "id"
              field_value = $configuration.id
              lock = true
            } as $locked_configuration
          
            precondition ($locked_configuration != null && $locked_configuration.config_id == $configuration.config_id && ($locked_configuration.data_environment|first_notempty:"") == $expected_data_environment && $locked_configuration.starter_id == $starter.id && $locked_configuration.starter_memberstack_id == $starter.memberstack_id && $locked_configuration.grant_id == $configuration.grant_id && $locked_configuration.active && ($locked_configuration.sync_status|first_notempty:"") == "ready" && ($locked_configuration.revision|first_notempty:0) == ($configuration.revision|first_notempty:0) && $locked_configuration.is_paid == $configuration.is_paid && $locked_configuration.duration == $configuration.duration && ($locked_configuration.price_cents|first_notempty:0) == ($configuration.price_cents|first_notempty:0) && ($locked_configuration.currency|first_notempty:"") == ($configuration.currency|first_notempty:"") && ($locked_configuration.payment_environment|first_notempty:"") == ($configuration.payment_environment|first_notempty:"")) {
              error_type = "inputerror"
              error = "Bookable service changed before booking intent was claimed"
            }
          
            // Claim only the card the Brand reviewed. The upsert also checks this captured
            // identity before writing its payment snapshot; it cannot substitute a new default.
            conditional {
              if ($configuration.is_paid) {
                db.get brands_v3 {
                  field_name = "id"
                  field_value = $brand.id
                  lock = true
                } as $locked_brand

                var $locked_payment_method {
                  value = $payment_environment == "test" ? $locked_brand.stripe_payment_method_test : $locked_brand.stripe_payment_method_live
                }

                precondition ($locked_brand != null && $locked_brand.memberstack_id == $brand_member_id && $locked_payment_method == $brand_payment_method && ($reviewed_payment_method == "" || $locked_payment_method == $reviewed_payment_method)) {
                  error_type = "inputerror"
                  error = "Selected payment method changed. Review your card and try again."
                }
              }
            }

            db.add adminops_booking_commands_v3 {
              data = {
                data_environment    : $expected_data_environment
                updated_at          : now
                idempotency_key     : $input.idempotency_key
                command_type        : "booking_request"
                actor_memberstack_id: $brand_member_id
                configuration_id    : $locked_configuration.config_id
                status              : "provider_pending"
                request_fingerprint : $fingerprint
                safe_result         : ($reviewed_card != null ? {claimed_payment_method_id: $reviewed_payment_method, claimed_customer_id: $brand_customer, claimed_payment_method: $reviewed_card} : null)
              }
            } as $created_command
          
            var.update $command {
              value = $created_command
            }
          }
        }
      
        var $provider_configuration_url {
          value = "https://api.us.nylas.com/v3/grants/"
            |concat:($configuration.grant_id|url_encode):""
            |concat:"/scheduling/configurations/":""
            |concat:($configuration.config_id|url_encode):""
        }
      
        api.request {
          url = $provider_configuration_url
          method = "GET"
          headers = []
            |push:"Accept: application/json, application/gzip"
            |push:$nylas_auth_header
          timeout = 30
        } as $provider_configuration
      
        var $provider_configuration_data {
          value = $provider_configuration.response.result|get:"data":{}
        }
      
        precondition ($provider_configuration.response.status == 200 && ($provider_configuration_data|get:"id":"") == $configuration.config_id) {
          error_type = "accessdenied"
          error = "Provider configuration contract does not match the canonical service"
        }
      
        // Re-read after the claim: an Off command may have closed public access meanwhile.
        // The current request already owns its pre-cutoff booking_request command.
        db.get nylas_configurations_v3 {
          field_name = "id"
          field_value = $configuration.id
        } as $claimed_service_state
      
        precondition ($claimed_service_state != null && $claimed_service_state.config_id == $configuration.config_id && $claimed_service_state.grant_id == $configuration.grant_id && $claimed_service_state.starter_memberstack_id == $starter.memberstack_id && ($claimed_service_state.data_environment|first_notempty:"") == $expected_data_environment && $claimed_service_state.is_paid == $configuration.is_paid) {
          error_type = "accessdenied"
          error = "Claimed booking configuration identity changed"
        }
      
        var $requires_booking_session {
          value = ($provider_configuration_data|get:"requires_session_auth":false) == true
        }
      
        precondition (($configuration.is_paid && $requires_booking_session) || ($configuration.is_paid == false && ($requires_booking_session == false || $claimed_service_state.active == false))) {
          error_type = "accessdenied"
          error = "Claimed booking provider access does not match service state"
        }
      
        var $session_id {
          value = ""
        }
      
        conditional {
          if ($requires_booking_session) {
            api.request {
              url = "https://api.us.nylas.com/v3/scheduling/sessions"
              method = "POST"
              params = {
                configuration_id: $configuration.config_id
                time_to_live    : 10
              }
            
              headers = []
                |push:"Accept: application/json"
                |push:$nylas_auth_header
                |push:"Content-Type: application/json"
              timeout = 30
            } as $session
          
            conditional {
              if ($session.response.status < 200 || $session.response.status >= 300 || ($session.response.result|get:"data":{}|get:"session_id":"") == "") {
                db.edit adminops_booking_commands_v3 {
                  field_name = "id"
                  field_value = $command.id
                  data = {
                    updated_at: now
                    status    : "failed"
                    last_error: "Private booking session could not be created"
                  }
                } as $failed_session_command
              
                precondition (false) {
                  error = "Private booking session could not be created"
                }
              }
            }
          
            var.update $session_id {
              value = $session.response.result
                |get:"data":{}
                |get:"session_id":""
            }
          }
        }
      
        var $availability_response {
          value = null
        }
      
        conditional {
          if ($requires_booking_session) {
            api.request {
              url = "https://api.us.nylas.com/v3/scheduling/availability"
                |concat:"?start_time=":""
                |concat:(($input.start|divide:1000)|to_int):""
                |concat:"&end_time=":""
                |concat:(($input.end|divide:1000)|to_int):""
              method = "GET"
              headers = []
                |push:"Accept: application/json"
                |push:("Authorization: Bearer "|concat:$session_id:"")
              timeout = 30
            } as $private_availability
          
            var.update $availability_response {
              value = $private_availability.response
            }
          }
        
          else {
            api.request {
              url = "https://api.us.nylas.com/v3/scheduling/availability"
                |concat:"?start_time=":""
                |concat:(($input.start|divide:1000)|to_int):""
                |concat:"&end_time=":""
                |concat:(($input.end|divide:1000)|to_int):""
                |concat:"&configuration_id=":""
                |concat:($configuration.config_id|url_encode):""
              method = "GET"
              headers = []
                |push:"Accept: application/json, application/gzip"
                |push:$nylas_auth_header
              timeout = 30
            } as $public_availability
          
            var.update $availability_response {
              value = $public_availability.response
            }
          }
        }
      
        // Public-to-private transition: retry this read only after exact identity proof.
        conditional {
          if ($configuration.is_paid == false && $requires_booking_session == false && $availability_response.status == 404 && ($availability_response.result|get:"error.type":"") == "not_found_error") {
            db.get nylas_configurations_v3 {
              field_name = "id"
              field_value = $configuration.id
            } as $transition_service
          
            precondition ($transition_service != null && $transition_service.config_id == $configuration.config_id && $transition_service.grant_id == $configuration.grant_id && $transition_service.starter_memberstack_id == $starter.memberstack_id && ($transition_service.data_environment|first_notempty:"") == $expected_data_environment && $transition_service.is_paid == false && $transition_service.active == false) {
              error_type = "accessdenied"
              error = "Unavailable configuration is not a retained owned service"
            }
          
            api.request {
              url = $provider_configuration_url
              method = "GET"
              headers = []
                |push:"Accept: application/json"
                |push:$nylas_auth_header
              timeout = 30
            } as $transition_provider
          
            precondition ($transition_provider.response.status == 200 && ($transition_provider.response.result|get:"data.id":"") == $configuration.config_id && ($transition_provider.response.result|get:"data.requires_session_auth":false)) {
              error_type = "accessdenied"
              error = "Provider private transition could not be verified"
            }
          
            api.request {
              url = "https://api.us.nylas.com/v3/scheduling/sessions"
              method = "POST"
              params = {
                configuration_id: $configuration.config_id
                time_to_live    : 10
              }
            
              headers = []
                |push:"Accept: application/json"
                |push:"Content-Type: application/json"
                |push:$nylas_auth_header
              timeout = 30
            } as $transition_session
          
            precondition ($transition_session.response.status >= 200 && $transition_session.response.status < 300 && ($transition_session.response.result|get:"data.session_id":"") != "") {
              error = "Retained booking request session is unavailable"
            }
          
            var.update $session_id {
              value = $transition_session.response.result|get:"data.session_id":""
            }
          
            var.update $requires_booking_session {
              value = true
            }
          
            api.request {
              url = "https://api.us.nylas.com/v3/scheduling/availability"
                |concat:"?start_time=":""
                |concat:(($input.start|divide:1000)|to_int):""
                |concat:"&end_time=":""
                |concat:(($input.end|divide:1000)|to_int):""
              method = "GET"
              headers = []
                |push:"Accept: application/json"
                |push:("Authorization: Bearer "|concat:$session_id:"")
              timeout = 30
            } as $transition_availability
          
            var.update $availability_response {
              value = $transition_availability.response
            }
          }
        }
      
        conditional {
          if ($availability_response.status != 200 || (($availability_response.result|get:"data":{}|get:"time_slots":[])|filter:"this.start_time == (($input.start|divide:1000)|to_int) && this.end_time == (($input.end|divide:1000)|to_int)"|count) == 0) {
            db.edit adminops_booking_commands_v3 {
              field_name = "id"
              field_value = $command.id
              data = {
                updated_at: now
                status    : "failed"
                last_error: "Selected slot is unavailable or could not be verified"
              }
            } as $failed_availability_command
          
            precondition (false) {
              error_type = "inputerror"
              error = "Selected slot is no longer available"
            }
          }
        }
      
        var $provider_response {
          value = null
        }
      
        conditional {
          if ($requires_booking_session) {
            api.request {
              url = "https://api.us.nylas.com/v3/scheduling/bookings"
                |concat:"?timezone=":""
                |concat:($input.timezone|url_encode):""
              method = "POST"
              params = ```
                {
                  start_time       : ($input.start|divide:1000)|to_int
                  end_time         : ($input.end|divide:1000)|to_int
                  guest            : {name: $brand.full_name, email: $brand.email_address}
                  additional_guests: $guest_participants
                  additional_fields: {
                    call_context          : $input.context|first_notempty:""
                    call_topic            : $input.topic|first_notempty:""
                    brand_memberstack_id  : $brand.memberstack_id
                    starter_memberstack_id: $starter.memberstack_id
                    unique_id             : $input.idempotency_key
                    from_stage            : "true"
                  }
                }
                ```
              headers = []
                |push:"Accept: application/json"
                |push:("Authorization: Bearer "|concat:$session_id:"")
                |push:"Content-Type: application/json"
              timeout = 30
            } as $private_provider
          
            var.update $provider_response {
              value = $private_provider.response
            }
          }
        
          else {
            api.request {
              url = "https://api.us.nylas.com/v3/scheduling/bookings"
                |concat:"?timezone=":""
                |concat:($input.timezone|url_encode):""
                |concat:"&configuration_id=":""
                |concat:($configuration.config_id|url_encode):""
              method = "POST"
              params = {
                start_time       : ($input.start|divide:1000)|to_int
                end_time         : ($input.end|divide:1000)|to_int
                guest            : {name: $brand.full_name, email: $brand.email_address}
                additional_guests: $guest_participants
              }
            
              headers = []
                |push:"Accept: application/json"
                |push:"Content-Type: application/json"
              timeout = 30
            } as $public_provider
          
            var.update $provider_response {
              value = $public_provider.response
            }
          }
        }
      
        // Retry only an explicit pre-booking configuration access rejection.
        // A timeout, 5xx, unknown 404, or response carrying a booking identity is not retryable.
        conditional {
          if ($configuration.is_paid == false && $requires_booking_session == false && $provider_response.status == 404 && ($provider_response.result|get:"error.type":"") == "not_found_error" && ($provider_response.result|get:"error.message":"") == "Configuration not found" && ($provider_response.result|get:"data.booking_id":"") == "") {
            db.get nylas_configurations_v3 {
              field_name = "id"
              field_value = $configuration.id
            } as $create_transition_service
          
            precondition ($create_transition_service != null && $create_transition_service.config_id == $configuration.config_id && $create_transition_service.grant_id == $configuration.grant_id && $create_transition_service.starter_memberstack_id == $starter.memberstack_id && ($create_transition_service.data_environment|first_notempty:"") == $expected_data_environment && $create_transition_service.is_paid == false && $create_transition_service.active == false) {
              error_type = "accessdenied"
              error = "Unavailable configuration is not a retained owned service"
            }
          
            api.request {
              url = $provider_configuration_url
              method = "GET"
              headers = []
                |push:"Accept: application/json"
                |push:$nylas_auth_header
              timeout = 30
            } as $create_transition_provider
          
            precondition ($create_transition_provider.response.status == 200 && ($create_transition_provider.response.result|get:"data.id":"") == $configuration.config_id && ($create_transition_provider.response.result|get:"data.requires_session_auth":false)) {
              error_type = "accessdenied"
              error = "Provider private transition could not be verified"
            }
          
            api.request {
              url = "https://api.us.nylas.com/v3/scheduling/sessions"
              method = "POST"
              params = {
                configuration_id: $configuration.config_id
                time_to_live    : 10
              }
            
              headers = []
                |push:"Accept: application/json"
                |push:"Content-Type: application/json"
                |push:$nylas_auth_header
              timeout = 30
            } as $create_transition_session
          
            precondition ($create_transition_session.response.status >= 200 && $create_transition_session.response.status < 300 && ($create_transition_session.response.result|get:"data.session_id":"") != "") {
              error = "Retained booking request session is unavailable"
            }
          
            var.update $session_id {
              value = $create_transition_session.response.result|get:"data.session_id":""
            }
          
            var.update $requires_booking_session {
              value = true
            }
          
            api.request {
              url = "https://api.us.nylas.com/v3/scheduling/bookings"
                |concat:"?timezone=":""
                |concat:($input.timezone|url_encode):""
              method = "POST"
              params = ```
                {
                  start_time       : ($input.start|divide:1000)|to_int
                  end_time         : ($input.end|divide:1000)|to_int
                  guest            : {name: $brand.full_name, email: $brand.email_address}
                  additional_guests: $guest_participants
                  additional_fields: {
                    call_context          : $input.context|first_notempty:""
                    call_topic            : $input.topic|first_notempty:""
                    brand_memberstack_id  : $brand.memberstack_id
                    starter_memberstack_id: $starter.memberstack_id
                    unique_id             : $input.idempotency_key
                    from_stage            : "true"
                  }
                }
                ```
              headers = []
                |push:"Accept: application/json"
                |push:("Authorization: Bearer "|concat:$session_id:"")
                |push:"Content-Type: application/json"
              timeout = 30
            } as $create_transition_result
          
            var.update $provider_response {
              value = $create_transition_result.response
            }
          }
        }
      
        conditional {
          if ($provider_response.status >= 200 && $provider_response.status < 300) {
            var $provider_data {
              value = $provider_response.result|get:"data":{}
            }
          
            // Persist the provider identity before canonical upsert. A crash or #282 failure can
            // then be reconciled without issuing another Nylas booking POST.
            db.edit adminops_booking_commands_v3 {
              field_name = "id"
              field_value = $command.id
              data = {
                data_environment   : $expected_data_environment
                updated_at         : now
                booking_id         : $provider_data|get:"booking_id":""
                provider_request_id: $provider_response.result|get:"request_id":""
                status             : "reconciliation_required"
                last_error         : "Provider booking exists; canonical persistence is pending"
              }
            } as $provider_booking_command
          
            var $booking {
              value = null
            }
          
            var $booking_upsert_error {
              value = null
            }
          
            try_catch {
              try {
                function.run "Bookings/upsert_from_nylas_v3" {
                  input = {
                    booking_id                     : $provider_data.booking_id
                    booking_ref                    : $provider_data.booking_ref
                    config_id                      : $configuration.config_id
                    grant_id                       : $configuration.grant_id
                    start                          : $input.start
                    end                            : $input.end
                    starter_memberstack_id         : $starter.memberstack_id
                    brand_memberstack_id           : $brand.memberstack_id
                    nylas_request_id               : $provider_response.result|get:"request_id":""
                    event_id                       : $provider_data|get:"event_id":""
                    meeting_link                   : $provider_data|get:"meeting_link":""
                    call_context                   : $input.context
                    unique_id                      : $input.idempotency_key
                    participants                   : $guest_participants
                    payment_environment            : $payment_environment
                    expected_configuration_revision: $configuration.revision
                    expected_amount_cents          : $configuration.price_cents
                    expected_duration              : $configuration.duration
                    expected_destination_account   : ($configuration.is_paid ? $starter_connect_id : null)
                    expected_customer_id           : ($configuration.is_paid ? $brand_customer : null)
                    expected_payment_method_id     : ($configuration.is_paid ? $brand_payment_method : null)
                  }
                } as $upserted_booking
              
                var.update $booking {
                  value = $upserted_booking
                }
              }
            
              catch {
                var.update $booking_upsert_error {
                  value = $error[""]
                }
              }
            }
          
            conditional {
              if ($booking_upsert_error != null || $booking == null) {
                db.edit adminops_booking_commands_v3 {
                  field_name = "id"
                  field_value = $command.id
                  data = {
                    updated_at         : now
                    provider_request_id: $provider_response.result|get:"request_id":""
                    status             : "reconciliation_required"
                    last_error         : "Nylas booking exists but canonical V3 persistence is unresolved"
                  }
                } as $unresolved_persistence_command
              
                precondition (false) {
                  error = "Nylas booking persistence is unresolved; reconciliation is required"
                }
              }
            }
          
            var.update $result {
              value = {
                booking_id  : $booking.booking_id
                row_id      : $booking.row_id
                status      : $booking.status
                config_id   : $configuration.config_id
                start       : $input.start
                end         : $input.end
                paid        : $configuration.is_paid
                amount_cents: $booking.amount_cents
                currency    : $booking.currency
                guest_count : $guest_participants|count
              }
            }
          
            function.run "Bookings/payment_receipt_v3" {
              input = {booking_row_id: $booking.row_id, brand_memberstack_id: $brand_member_id, payment_environment: $payment_environment}
            } as $payment_receipt

            var.update $result {
              value = $result|set:"payment_method_id":($payment_receipt|get:"payment_method_id":null)|set:"payment_method":($payment_receipt|get:"payment_method":null)
            }

            db.edit adminops_booking_commands_v3 {
              field_name = "id"
              field_value = $command.id
              data = {
                updated_at         : now
                booking_id         : $booking.booking_id
                provider_request_id: $provider_response.result|get:"request_id":""
                status             : "completed"
                safe_result        : $result
                last_error         : null
              }
            } as $completed_command
          }
        
          else {
            db.edit adminops_booking_commands_v3 {
              field_name = "id"
              field_value = $command.id
              data = {
                updated_at         : now
                provider_request_id: $provider_response.result|get:"request_id":""
                status             : "reconciliation_required"
                last_error         : "Nylas booking failed with HTTP "|concat:$provider_response.status:""|concat:" error_type=":""|concat:($provider_response.result|get:"error":{}|get:"type":""):""
              }
            } as $unresolved_command
          
            precondition (false) {
              error = "Nylas booking creation is unresolved; reconciliation is required"
            }
          }
        }
      }
    }
  
    function.run "Bookings/enqueue_booking_notification_v3" {
      input = {
        booking_id     : $result|get:"booking_id":""
        event_type     : "booking_requested"
        audience       : "both"
        idempotency_key: $input.idempotency_key|concat:":notify-requested":""
        safe_payload   : {
        start: $result|get:"start":$input.start
        end  : $result|get:"end":$input.end
        paid : $result|get:"paid":false
      }
      }
    } as $notification
  }

  response = {
    booking  : $result
    duplicate: $duplicate
    recovered: $recovered
  }

  tags = ["brand", "booking", "v3"]
  guid = "3MlOFuRf9xJW9Lrxfh5ZICs4Xx8"
}