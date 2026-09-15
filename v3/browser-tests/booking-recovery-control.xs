// TEST WORKSPACE ONLY. Protected fixture setup/inspection, never a release candidate.
query "test-harness/control" verb=POST {
  api_group = "Scheduling Calls In-App"

  input {
    enum action {
      values = [
        "seed"
        "inspect"
        "default"
        "user-environment"
        "readiness"
        "configuration-patch"
        "booking-patch"
        "command-patch"
        "command-add"
        "upsert"
      ]
    }
  
    text run_id filters=trim
    json? payload?
  }

  stack {
    var $control_key {
      value = $env.$http_headers["X-Paid-Call-Harness"]
        |first_notempty:($env.$http_headers["x-paid-call-harness"]|first_notempty:"")
    }
  
    precondition ($env.paid_call_harness_enabled == "isolated-paid-call-20260915" && ($env.paid_call_harness_key|strlen) >= 32 && $control_key == $env.paid_call_harness_key) {
      error_type = "accessdenied"
      error = "Isolated harness access required"
    }
  
    precondition ("/^[a-z0-9]{12}$/"|regex_matches:$input.run_id) {
      error_type = "inputerror"
      error = "Invalid synthetic run identity"
    }
  
    var $brand_member {
      value = "mem_sb_pc_brand_"|concat:$input.run_id:""
    }
  
    var $starter_member {
      value = "mem_sb_pc_starter_"|concat:$input.run_id:""
    }
  
    var $customer {
      value = "cus_pc_"|concat:$input.run_id:""
    }
  
    var $card_a {
      value = "pm_pc_a_"|concat:$input.run_id:""
    }
  
    var $config_id {
      value = "pc_paid_"|concat:$input.run_id:""
    }
  
    var $grant {
      value = "pc_grant_"|concat:$input.run_id:""
    }
  
    var $slug {
      value = "pc-starter-"|concat:$input.run_id:""
    }
  
    var $result {
      value = null
    }
  
    db.get user_v3 {
      field_name = "memberstack_member_id"
      field_value = $brand_member
    } as $user
  
    conditional {
      if ($input.action == "seed") {
        precondition ($user == null) {
          error_type = "inputerror"
          error = "Use a fresh synthetic run; fixture reset is not supported"
        }
      
        db.add user_v3 {
          data = {
            name                 : "Synthetic Brand"
            "first-name"         : "Synthetic"
            "last-name"          : "Brand"
            email                : $input.run_id|concat:"-brand@example.invalid":""
            memberstack_member_id: $brand_member
            data_environment     : "test"
          }
        } as $brand_user
      
        db.add user_v3 {
          data = {
            name                 : "Synthetic Starter"
            "first-name"         : "Synthetic"
            "last-name"          : "Starter"
            email                : $input.run_id|concat:"-starter@example.invalid":""
            memberstack_member_id: $starter_member
            data_environment     : "test"
          }
        } as $starter_user
      
        db.add brands_v3 {
          data = {
            full_name                         : "Synthetic Brand"
            email_address                     : $brand_user.email
            memberstack_id                    : $brand_member
            stripe_customer_id_test           : $customer
            stripe_payment_method_test        : $card_a
            stripe_payment_readiness_test     : "ready"
            stripe_payment_last_synced_at_test: now
          }
        } as $brand
      
        db.add freelancers_v3 {
          data = {
            Name                         : "Synthetic Starter"
            Email                        : $starter_user.email
            memberstack_id               : $starter_member
            webflow_slug_30              : $slug
            stripe_connect_id_test       : "acct_pc_"|concat:$input.run_id:""
            stripe_charges_enabled_test  : true
            stripe_connect_synced_at_test: now
          }
        } as $starter
      
        db.add availability_v3 {
          data = {
            memberstack_id  : $starter_member
            name            : "Synthetic Starter"
            email           : $starter_user.email
            timezone        : "UTC"
            nylas_grant_id  : $grant
            data_environment: "test"
          }
        } as $availability
      
        db.add nylas_configurations_v3 {
          data = {
            config_id             : $config_id
            grant_id              : $grant
            starter_id            : $starter.id
            starter_memberstack_id: $starter_member
            data_environment      : "test"
            title                 : "Synthetic Paid Call"
            is_paid               : true
            payment_environment   : "test"
            price                 : 25
            price_cents           : 2500
            currency              : "usd"
            duration              : 30
            active                : true
            revision              : 1
            sync_status           : "ready"
          }
        } as $paid
      
        db.add nylas_configurations_v3 {
          data = {
            config_id             : "pc_free_"|concat:$input.run_id:""
            grant_id              : $grant
            starter_id            : $starter.id
            starter_memberstack_id: $starter_member
            data_environment      : "test"
            title                 : "Synthetic Free Call"
            is_paid               : false
            payment_environment   : "test"
            price                 : 0
            price_cents           : 0
            currency              : "usd"
            duration              : 30
            active                : true
            revision              : 1
            sync_status           : "ready"
          }
        } as $free
      
        security.create_auth_token {
          table = "user_v3"
          extras = {}
          expiration = 3600
          id = $brand_user.id
        } as $token
      
        var.update $result {
          value = {
            token         : $token
            brand_member  : $brand_member
            starter_member: $starter_member
            config_id     : $config_id
            free_config_id: $free.config_id
            grant_id      : $grant
            starter_slug  : $slug
            customer      : $customer
            card_a        : $card_a
            card_b        : ("pm_pc_b_"|concat:$input.run_id:"")
            destination   : $starter.stripe_connect_id_test
          }
        }
      }
    
      else {
        precondition ($user != null) {
          error_type = "notfound"
          error = "Synthetic fixture does not exist"
        }
      
        db.get brands_v3 {
          field_name = "memberstack_id"
          field_value = $brand_member
        } as $fixture_brand
      
        precondition ($fixture_brand != null && $fixture_brand.stripe_customer_id_test == $customer) {
          error_type = "accessdenied"
          error = "Synthetic customer mismatch"
        }
      
        conditional {
          if ($input.action == "default") {
            precondition (($input.payload|get:"card":""|starts_with:"pm_pc_") && ($input.payload|get:"card":""|ends_with:$input.run_id)) {
              error_type = "inputerror"
              error = "Synthetic card required"
            }
          
            db.edit brands_v3 {
              field_name = "id"
              field_value = $fixture_brand.id
              data = {stripe_payment_method_test: $input.payload.card}
            } as $updated
          }
        
          elseif ($input.action == "user-environment") {
            db.edit user_v3 {
              field_name = "id"
              field_value = $user.id
              data = {data_environment: $input.payload.environment}
            } as $updated
          }
        
          elseif ($input.action == "readiness") {
            db.edit brands_v3 {
              field_name = "id"
              field_value = $fixture_brand.id
              data = {
                stripe_payment_readiness_test     : $input.payload.readiness
                stripe_payment_last_synced_at_test: $input.payload|get:"synced_at":now
              }
            } as $updated
          }
        
          elseif ($input.action == "configuration-patch") {
            db.get nylas_configurations_v3 {
              field_name = "config_id"
              field_value = $config_id
            } as $fixture_configuration
            precondition ($fixture_configuration != null && $fixture_configuration.data_environment == "test" && $fixture_configuration.starter_memberstack_id == $starter_member) {
              error_type = "accessdenied"
              error = "Synthetic configuration mismatch"
            }
            db.patch nylas_configurations_v3 {
              field_name = "id"
              field_value = $fixture_configuration.id
              data = $input.payload.patch
            } as $updated
            var.update $result { value = {ok: true} }
          }
          elseif ($input.action == "booking-patch") {
            db.get nylas_bookings_v3 {
              field_name = "booking_id"
              field_value = $input.payload.booking_id
            } as $fixture_target
          
            precondition ($fixture_target != null && ($fixture_target.unique_id|starts_with:($input.run_id|concat:"-":""))) {
              error_type = "accessdenied"
              error = "Synthetic booking required"
            }
          
            db.patch nylas_bookings_v3 {
              field_name = "id"
              field_value = $fixture_target.id
              data = $input.payload.patch
            } as $updated
          }
        
          elseif ($input.action == "command-patch") {
            db.get adminops_booking_commands_v3 {
              field_name = "idempotency_key"
              field_value = $input.payload.key
            } as $fixture_target
          
            precondition ($fixture_target != null && ($fixture_target.idempotency_key|starts_with:($input.run_id|concat:"-":""))) {
              error_type = "accessdenied"
              error = "Synthetic command required"
            }
          
            db.patch adminops_booking_commands_v3 {
              field_name = "id"
              field_value = $fixture_target.id
              data = $input.payload.patch
            } as $updated
          }
        
          elseif ($input.action == "command-add") {
            precondition (($input.payload.idempotency_key|starts_with:($input.run_id|concat:"-":"")) && $input.payload.actor_memberstack_id == $brand_member) {
              error_type = "accessdenied"
              error = "Synthetic command required"
            }
          
            db.add adminops_booking_commands_v3 {
              data = {
                idempotency_key     : $input.payload.idempotency_key
                actor_memberstack_id: $brand_member
                data_environment    : "test"
                updated_at          : now
                command_type        : "booking_request"
                configuration_id    : $config_id
                booking_id          : $input.payload.booking_id
                status              : "reconciliation_required"
                request_fingerprint : "synthetic-internal-upsert"
                safe_result         : $input.payload.safe_result
              }
            } as $updated
          }
        
          elseif ($input.action == "upsert") {
            precondition ($input.payload.brand_memberstack_id == $brand_member && $input.payload.starter_memberstack_id == $starter_member && ($input.payload.booking_id|starts_with:($input.run_id|concat:"-":""))) {
              error_type = "accessdenied"
              error = "Synthetic upsert required"
            }
          
            function.run "Bookings/upsert_from_nylas_v3" {
              input = {
                booking_id                     : $input.payload.booking_id
                booking_ref                    : $input.payload.booking_ref
                config_id                      : $input.payload.config_id
                grant_id                       : $input.payload.grant_id
                start                          : $input.payload.start
                end                            : $input.payload.end
                starter_memberstack_id         : $input.payload.starter_memberstack_id
                brand_memberstack_id           : $input.payload.brand_memberstack_id
                nylas_request_id               : $input.payload.nylas_request_id
                event_id                       : $input.payload.event_id
                meeting_link                   : $input.payload.meeting_link
                call_context                   : $input.payload.call_context
                unique_id                      : $input.payload.unique_id
                participants                   : $input.payload.participants
                payment_environment            : $input.payload.payment_environment
                expected_configuration_revision: $input.payload.expected_configuration_revision
                expected_amount_cents          : $input.payload.expected_amount_cents
                expected_duration              : $input.payload.expected_duration
                expected_destination_account   : $input.payload.expected_destination_account
                expected_customer_id           : $input.payload.expected_customer_id
                expected_payment_method_id     : $input.payload.expected_payment_method_id
              }
            } as $upsert_result
          
            var.update $result {
              value = $upsert_result
            }
          }
        }
      
        conditional {
          if ($input.action != "upsert") {
            db.get brands_v3 {
              field_name = "id"
              field_value = $fixture_brand.id
            } as $current_brand
          
            db.query adminops_booking_commands_v3 {
              where = $db.adminops_booking_commands_v3.idempotency_key includes $input.run_id
              return = {type: "list"}
            } as $commands
          
            db.query nylas_bookings_v3 {
              where = $db.nylas_bookings_v3.unique_id includes $input.run_id
              return = {type: "list"}
            } as $bookings
          
            // Explicit synthetic-only projection keeps private DB fields inspectable for assertions.
            var $booking_summaries {
              value = []
            }
          
            foreach ($bookings) {
              each as $row {
                array.push $booking_summaries {
                  value = {
                    id                               : $row.id
                    booking_id                       : $row.booking_id
                    unique_id                        : $row.unique_id
                    brand_data                       : $row.brand_data
                    data_environment                 : $row.data_environment
                    stripe_payment_method_id_snapshot: $row.stripe_payment_method_id_snapshot
                    stripe_customer_id_snapshot      : $row.stripe_customer_id_snapshot
                  }
                }
              }
            }
          
            var.update $result {
              value = {
                default_card: $current_brand.stripe_payment_method_test
                commands    : $commands
                bookings    : $booking_summaries
              }
            }
          }
        }
      }
    }
  }

  response = $result
  history = 0
  guid = "mQiHrusczztowENgTArBk9Z9uqY"
}