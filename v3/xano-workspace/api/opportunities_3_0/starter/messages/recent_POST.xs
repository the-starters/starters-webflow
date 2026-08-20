query "starter/messages/recent" verb=POST {
  api_group = "Opportunities 3.0"
  auth = "user_v3"

  input {
  }

  stack {
    precondition (($env.talkjs_api_secret != null) && ($env.talkjs_api_secret != "")) {
      error = "talkjs_api_secret env var not configured"
    }
  
    db.get user_v3 {
      field_name = "id"
      field_value = $auth.id
    } as $user
  
    precondition (($user == null) == false) {
      error_type = "notfound"
      error = "User not found"
    }
  
    var $member_id {
      value = $user.memberstack_member_id
    }
  
    precondition (($member_id != null) && ($member_id != "")) {
      error_type = "notfound"
      error = "Member id not found"
    }
  
    api.request {
      url = "https://api.talkjs.com/v1/LmYV8DIA/users/"
        |concat:$member_id:""
        |concat:"/conversations?limit=3&lastMessageAfter=0&sortBy=lastActivity+DESC":""
      method = "GET"
      headers = []
        |push:("Authorization: Bearer "|concat:$env.talkjs_api_secret:"")
    } as $talkjs
  
    precondition ($talkjs.response.status == 200) {
      error = "TalkJS request failed"
    }
  
    var $conversation_rows {
      value = []
    }
  
    var $participant_requests {
      value = []
    }
  
    foreach ($talkjs.response.result.data) {
      each as $conv {
        object.keys {
          value = $conv.participants
        } as $participant_ids
      
        array.difference ($participant_ids) {
          value = []|push:$member_id
          by = $this
        } as $other_participant_ids
      
        var $participant_id {
          value = $other_participant_ids|first
        }
      
        var.update $conversation_rows {
          value = $conversation_rows
            |push:```
              {
                id: $conv.id
                subject: $conv.subject
                photo_url: $conv.photoUrl
                participant_id: $participant_id
                unread: ($conv.isUnread == true)
                last_message_text: $conv.lastMessage.text
                last_message_sender_id: $conv.lastMessage.senderId
                last_message_at: $conv.lastMessage.createdAt
              }
              ```
        }
      
        conditional {
          if ($participant_id != null && $participant_id != "") {
            var $participant_request {
              value = []
                |push:($participant_requests|count)
                |push:"GET"
                |push:("/users/"|concat:$participant_id:"")
            }
          
            var.update $participant_requests {
              value = $participant_requests|push:$participant_request
            }
          }
        }
      }
    }
  
    var $participant_users {
      value = {}
    }
  
    conditional {
      if (($participant_requests|count) > 0) {
        api.request {
          url = "https://api.talkjs.com/v1/LmYV8DIA/batch"
          method = "POST"
          params = $participant_requests
          headers = []
            |push:("Authorization: Bearer "|concat:$env.talkjs_api_secret:"")
            |push:"Content-Type: application/json"
        } as $participant_batch
      
        precondition ($participant_batch.response.status == 200) {
          error = "TalkJS participant request failed"
        }
      
        foreach ($participant_batch.response.result) {
          each as $participant_result {
            conditional {
              if ($participant_result[1] == 200 && $participant_result[2].id != null) {
                var.update $participant_users {
                  value = $participant_users
                    |set:$participant_result[2].id:$participant_result[2]
                }
              }
            }
          }
        }
      }
    }
  
    var $items {
      value = []
    }
  
    foreach ($conversation_rows) {
      each as $row {
        var $participant {
          value = $participant_users[$row.participant_id]
        }
      
        var.update $items {
          value = $items
            |push:```
              {
                id: $row.id
                subject: $row.subject
                photo_url: $row.photo_url
                participant_name: $participant.name
                participant_photo_url: $participant.photoUrl
                unread: $row.unread
                last_message_text: $row.last_message_text
                last_message_sender_id: $row.last_message_sender_id
                last_message_at: $row.last_message_at
              }
              ```
        }
      }
    }
  }

  response = {items: $items}
  guid = "kmjgeQ6ZMSAL5_i0i5wYMEWIBMU"
}
