import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    'acl-guest-wifi-code-field-read': {
                        table: 'sys_security_acl'
                        id: '14cb76217e814212a2e47a22a8a89c91'
                    }
                    'acl-guest-wifi-create-itil': {
                        table: 'sys_security_acl'
                        id: '0d968877cd9d4a5186f72e113037ef28'
                    }
                    'acl-guest-wifi-delete-itil': {
                        table: 'sys_security_acl'
                        id: '5d0279f621f84797885f8d50d628b138'
                    }
                    'acl-guest-wifi-read-itil': {
                        table: 'sys_security_acl'
                        id: '76b5fec503b9426f821dbfbdc3742023'
                    }
                    'acl-guest-wifi-read-requester': {
                        table: 'sys_security_acl'
                        id: '2fa900c045f44164a1c5ba30a777a7a2'
                    }
                    'acl-guest-wifi-write-itil': {
                        table: 'sys_security_acl'
                        id: '5a0540bd6b344bd29020338f12a2d8c8'
                    }
                    bom_json: {
                        table: 'sys_module'
                        id: '29c0276b01ec4be7a51484ed11993845'
                    }
                    'br-guest-wifi-event': {
                        table: 'sys_script'
                        id: '556748b80b724332900dec79f5a9f5f5'
                    }
                    'br-guest-wifi-expiry': {
                        table: 'sys_script'
                        id: '501cf60b236540399c81a093042cc405'
                    }
                    'br-guest-wifi-populate': {
                        table: 'sys_script'
                        id: '03469a45cb34418295f078cf85e80a17'
                    }
                    'company-tshirt-request': {
                        table: 'sc_cat_item'
                        id: '620491dc1a2343508d724eb18ffaeb6b'
                        deleted: true
                    }
                    'employee-services-category': {
                        table: 'sc_category'
                        id: 'd721dc7ad1d549249232e5b6b49b89c9'
                        deleted: true
                    }
                    'evt-guest-wifi-voucher-issued': {
                        table: 'sysevent_register'
                        id: '50b6dcc1269e40f6bc3e2dff5c3eae0e'
                    }
                    'facilities-group': {
                        table: 'sys_user_group'
                        id: '2d5200ea138e4c54aec1c4245a5c4157'
                        deleted: true
                    }
                    'guest-wifi-catalog-trigger': {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '88045d8f74804739ac3c171deb745cde'
                    }
                    'guest-wifi-close-fulfilled': {
                        table: 'sys_hub_action_instance_v2'
                        id: '6ced0ce5f4cb457795327aae7271d27d'
                    }
                    'guest-wifi-close-no-manager': {
                        table: 'sys_hub_action_instance_v2'
                        id: '00ba3d8a0b9d4910a938ad7755ab617e'
                    }
                    'guest-wifi-close-rejected': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'f0e229deb56f4eeea72f3606d2fd7606'
                    }
                    'guest-wifi-create-voucher': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'cad5fbfb74b548c7a32a85c2c5c0cb8e'
                    }
                    'guest-wifi-else-has-manager': {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '60bb8d3c4f094292a2d4cbc5f7e89ea0'
                    }
                    'guest-wifi-else-rejected': {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '8b0be8441fab494aaee7ba10719d25ee'
                    }
                    'guest-wifi-email-approved': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'ca022866f96e461da3286af196aece36'
                    }
                    'guest-wifi-email-no-manager': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'bdee81d1101f4834926a29ea9c18056c'
                    }
                    'guest-wifi-email-rejected': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'cb4465cd3c17420fa22dd6e5c2fae938'
                    }
                    'guest-wifi-fulfillment-task': {
                        table: 'sys_hub_action_instance_v2'
                        id: '06e1f94a6173466f90aab29c56f10505'
                    }
                    'guest-wifi-if-approved': {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '1dddbd3962fc4820a03b7cd9b310f6d4'
                    }
                    'guest-wifi-if-no-manager': {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: 'f3343dee82e448b7a6a4fdb83c40d324'
                    }
                    'guest-wifi-justification-check': {
                        table: 'catalog_script_client'
                        id: '8180818030324deb8fd25bfa11c75faf'
                    }
                    'guest-wifi-lookup-voucher': {
                        table: 'sys_hub_action_instance_v2'
                        id: '988a438790cb4689898d528e6bd56340'
                    }
                    'guest-wifi-manager-approval': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'd7b5a184d6204cba818345723e4fa903'
                    }
                    'guest-wifi-voucher-fulfillment': {
                        table: 'sys_hub_flow'
                        id: '8d3ad245901e430c867d3eca70a70d74'
                    }
                    'guest-wifi-voucher-request': {
                        table: 'sc_cat_item'
                        id: 'dda5b43c0c714d49859c439f0b37e2f0'
                    }
                    'guest-wifi-wait-task': {
                        table: 'sys_hub_action_instance_v2'
                        id: '7c421d5610b34c6fb036053b9bf316ff'
                    }
                    'ntf-guest-wifi-mgr-approval': {
                        table: 'sysevent_email_action'
                        id: 'c57fe0e0a6e74faf80b50562b616c23a'
                    }
                    'ntf-guest-wifi-requester': {
                        table: 'sysevent_email_action'
                        id: 'f223ff96d75e421dbffb88e82bdff80e'
                    }
                    'ntf-guest-wifi-task': {
                        table: 'sysevent_email_action'
                        id: 'd3dd60146b5b40409406a2cc7127873f'
                    }
                    'ntf-guest-wifi-visitor': {
                        table: 'sysevent_email_action'
                        id: '1a4eb179aeed489cb573d5c018aac447'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '2bcefea8bd6d437fb1c07d3998de2e99'
                    }
                    'src_server_business-rules_guestWifiVoucher_ts': {
                        table: 'sys_module'
                        id: '13cbd9c2f3ca462aa9d79d92509cb13d'
                    }
                    'tshirt-catalog-trigger': {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '66596f2295e84c2abd52f3a23d96e549'
                        deleted: true
                    }
                    'tshirt-comment-length-check': {
                        table: 'catalog_script_client'
                        id: '26aca7c14f5940b982d63fec49276415'
                        deleted: true
                    }
                    'tshirt-else-rejected': {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '09abcc913af64ac7a81f35949db8fc6a'
                        deleted: true
                    }
                    'tshirt-fulfillment-task': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'd8f7e18259a749da92eda4d33edb3bed'
                        deleted: true
                    }
                    'tshirt-get-catalog-variables': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'cf944acffdbe4bf99efb27899cef9996'
                        deleted: true
                    }
                    'tshirt-if-approved': {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '8752eee262ed41e8abbe5056b4cbd778'
                        deleted: true
                    }
                    'tshirt-manager-approval': {
                        table: 'sys_hub_action_instance_v2'
                        id: '8d5e73b8a86641d69429add35cfefa63'
                        deleted: true
                    }
                    'tshirt-manager-readonly-policy': {
                        table: 'catalog_ui_policy'
                        id: '9f7950c2220f4b62bca99501ba498ecd'
                        deleted: true
                    }
                    'tshirt-notify-approval-request': {
                        table: 'sysevent_email_action'
                        id: 'ae92f6b99ca549d683e6a987c389a187'
                        deleted: true
                    }
                    'tshirt-notify-approved': {
                        table: 'sysevent_email_action'
                        id: 'a84a16d0178d4747ae53cc2eb6b5de87'
                        deleted: true
                    }
                    'tshirt-notify-closed-incomplete': {
                        table: 'sysevent_email_action'
                        id: 'c628a0821e6c4f2e90b0da8084fcfddd'
                        deleted: true
                    }
                    'tshirt-notify-facilities-new-task': {
                        table: 'sysevent_email_action'
                        id: 'b8c07320f52f4d838858b62980640290'
                        deleted: true
                    }
                    'tshirt-notify-fulfillment-complete': {
                        table: 'sysevent_email_action'
                        id: '01ab937a0c7f4ca6a184a683caf3fbce'
                        deleted: true
                    }
                    'tshirt-notify-rejected': {
                        table: 'sysevent_email_action'
                        id: '81d3f8fc86c74a48bd2680771726adba'
                        deleted: true
                    }
                    'tshirt-notify-submission': {
                        table: 'sysevent_email_action'
                        id: '940086d40de941a9a78755c99aaa29f8'
                        deleted: true
                    }
                    'tshirt-request-approval-fulfillment-flow': {
                        table: 'sys_hub_flow'
                        id: '3009317c122b49e3aa392401f2fd340a'
                        deleted: true
                    }
                    'tshirt-ritm-closed-incomplete': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'a3b32dca54254f0aa3eb3fd6ef4f293e'
                        deleted: true
                    }
                    'tshirt-ritm-work-in-progress': {
                        table: 'sys_hub_action_instance_v2'
                        id: '1e7e4c84f9ea422781f70e69b8294dea'
                        deleted: true
                    }
                }
                composite: [
                    {
                        table: 'sys_documentation'
                        id: '02924aebac134e97a30b323da8784875'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_requester'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sc_cat_item_catalog'
                        id: '05e704e4c83e4bf19c9a1daea0c30172'
                        key: {
                            sc_cat_item: 'dda5b43c0c714d49859c439f0b37e2f0'
                            sc_catalog: 'e0d08b13c3330100c8b837659bba8fb4'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '07f15c1885cf49b3a02e4758f948cfc3'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_state'
                            value: 'revoked'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '0eaf61511d5b4e14b0084a3b4ac41ed0'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_ssid'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '0fcc24c0bf1a43c0bed0d7412ca697c7'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_special_requests'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '1bfc294c766d4dcb80b0fa24b74bf90e'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_visitor_email'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '26d347d7845343e994e532df13a15ff0'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'NULL'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '2a53d5359afa437b8ca260048b727d52'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_business_justification'
                        }
                    },
                    {
                        table: 'question_choice'
                        id: '2a62b50377194798bd26d6ff223835c8'
                        key: {
                            question: {
                                id: '5f456571e4d34a959ed8309da125f1f7'
                                key: {
                                    cat_item: 'dda5b43c0c714d49859c439f0b37e2f0'
                                    variable_set: 'NULL'
                                    name: 'access_duration'
                                }
                            }
                            value: '30'
                        }
                    },
                    {
                        table: 'sc_cat_item_catalog'
                        id: '2f23106cb68143ca9176aca426684081'
                        deleted: true
                        key: {
                            sc_cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            sc_catalog: 'e0d08b13c3330100c8b837659bba8fb4'
                        }
                    },
                    {
                        table: 'sys_number'
                        id: '30c63f51c9d04121824e6b0952fe7428'
                        key: {
                            category: 'u_guest_wifi_voucher'
                            prefix: 'GWV'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: '31d00041aa20433e8baf0c8443d43522'
                        key: {
                            sys_security_acl: '5d0279f621f84797885f8d50d628b138'
                            sys_user_role: {
                                id: 'b9f03bc8ded54324aa80fb9370c5b415'
                                key: {
                                    name: 'itil'
                                }
                            }
                        }
                    },
                    {
                        table: 'question_choice'
                        id: '3302f7f3ae4848ce96e742a77c8109af'
                        deleted: true
                        key: {
                            question: {
                                id: '670f421d10004938a945d3bf85e1ee69'
                                key: {
                                    cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                                    variable_set: 'NULL'
                                    name: 'tshirt_size'
                                }
                            }
                            value: 'XL'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '378c91161472464c9c8b2ef74a9ee47d'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_voucher_code'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '3e233cd7abcf42538a2486b77cfb0b98'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_access_duration_days'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '3f6bf48d94764454a13ee38354072721'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_voucher_code'
                            language: 'en'
                        }
                    },
                    {
                        table: 'catalog_ui_policy_action'
                        id: '42902d5681f940aaacfdddeeccb54930'
                        deleted: true
                        key: {
                            ui_policy: '9f7950c2220f4b62bca99501ba498ecd'
                            catalog_variable: 'IO:8d64a373a26e4089a61a33e4d1da611e'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '4fec2a1bc7c74e0092bf4ef5f7294acf'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_issued_on'
                        }
                    },
                    {
                        table: 'question_choice'
                        id: '52bfc964ef7f4f26bcf2483d38c98a80'
                        deleted: true
                        key: {
                            question: {
                                id: '670f421d10004938a945d3bf85e1ee69'
                                key: {
                                    cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                                    variable_set: 'NULL'
                                    name: 'tshirt_size'
                                }
                            }
                            value: 'L'
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: '53a79e5423f7465e9a1c1c0b8b95df8e'
                        key: {
                            cat_item: 'dda5b43c0c714d49859c439f0b37e2f0'
                            variable_set: 'NULL'
                            name: 'visitor_email'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '5ad91b76e40c4145aa8750c54225dfdc'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_ssid'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sc_cat_item_user_criteria_mtom'
                        id: '5c2634637ee64c2e85e87f7178d1a936'
                        deleted: true
                        key: {
                            sc_cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            user_criteria: '7b8a6927ef732100438236caa5c0fb89'
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: '5ea1e93f635c4c708411083e0ff9261d'
                        key: {
                            cat_item: 'dda5b43c0c714d49859c439f0b37e2f0'
                            variable_set: 'NULL'
                            name: 'visitor_name'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: '5f1201eee19c49179a8a7587197766f5'
                        key: {
                            sys_security_acl: '0d968877cd9d4a5186f72e113037ef28'
                            sys_user_role: {
                                id: 'b9f03bc8ded54324aa80fb9370c5b415'
                                key: {
                                    name: 'itil'
                                }
                            }
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: '5f456571e4d34a959ed8309da125f1f7'
                        key: {
                            cat_item: 'dda5b43c0c714d49859c439f0b37e2f0'
                            variable_set: 'NULL'
                            name: 'access_duration'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '644484706898499493f4349d9121dad5'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_expiry'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '6692371c5ec8478d941960f96384c304'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_visitor_organization'
                            language: 'en'
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: '670f421d10004938a945d3bf85e1ee69'
                        deleted: true
                        key: {
                            cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            variable_set: 'NULL'
                            name: 'tshirt_size'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '676f75c652f842a8bdbc8e2e0922d79c'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_state'
                            value: 'expired'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '6de37abb9417431b8662fc133804f0e1'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_visitor_name'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '6ecdc3d114fc44138c0b67ec09f3c290'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'number'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '7036fc0b4a6245b4acffc783db33895c'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_access_duration_days'
                            language: 'en'
                        }
                    },
                    {
                        table: 'question_choice'
                        id: '71735b4f5e81438d8ca02f854c3e8ed8'
                        deleted: true
                        key: {
                            question: {
                                id: '670f421d10004938a945d3bf85e1ee69'
                                key: {
                                    cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                                    variable_set: 'NULL'
                                    name: 'tshirt_size'
                                }
                            }
                            value: 'M'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '73becb83cda546f4aebb0234434ac97e'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_request'
                            language: 'en'
                        }
                    },
                    {
                        table: 'question_choice'
                        id: '771b4c0ba4b147c7a7b02408380163ac'
                        key: {
                            question: {
                                id: '5f456571e4d34a959ed8309da125f1f7'
                                key: {
                                    cat_item: 'dda5b43c0c714d49859c439f0b37e2f0'
                                    variable_set: 'NULL'
                                    name: 'access_duration'
                                }
                            }
                            value: '1'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '7741d3842acb4dff9e491962a5d6c694'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'number'
                        }
                    },
                    {
                        table: 'sys_choice_set'
                        id: '7a044d607979482198ab7b53b59bcc30'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_state'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '7c1b0115056a41619a1a92dbc6852d29'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_state'
                            value: 'pending'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'question_choice'
                        id: '7cf280cf56404b6b8a612931b4ee52f2'
                        key: {
                            question: {
                                id: '5f456571e4d34a959ed8309da125f1f7'
                                key: {
                                    cat_item: 'dda5b43c0c714d49859c439f0b37e2f0'
                                    variable_set: 'NULL'
                                    name: 'access_duration'
                                }
                            }
                            value: '3'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: '7fd833dcf9cd4c2aa5595ed29a775b11'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_visitor_name'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '86e5860f04224de397ddaba9cb8c0390'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_special_requests'
                        }
                    },
                    {
                        table: 'question_choice'
                        id: '8c1314c34d92467680cdd0e6cb39524f'
                        deleted: true
                        key: {
                            question: {
                                id: '670f421d10004938a945d3bf85e1ee69'
                                key: {
                                    cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                                    variable_set: 'NULL'
                                    name: 'tshirt_size'
                                }
                            }
                            value: 'XXL'
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: '8d64a373a26e4089a61a33e4d1da611e'
                        deleted: true
                        key: {
                            cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            variable_set: 'NULL'
                            name: 'manager_display'
                        }
                    },
                    {
                        table: 'sys_db_object'
                        id: '8eb38de2da8d41e090197d203e93a791'
                        key: {
                            name: 'u_guest_wifi_voucher'
                        }
                    },
                    {
                        table: 'question_choice'
                        id: '93537255ab5a446f9ed1955a52588009'
                        key: {
                            question: {
                                id: '5f456571e4d34a959ed8309da125f1f7'
                                key: {
                                    cat_item: 'dda5b43c0c714d49859c439f0b37e2f0'
                                    variable_set: 'NULL'
                                    name: 'access_duration'
                                }
                            }
                            value: '7'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: '97eedda9b6fe451fb41ab68a8c94a4cc'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_state'
                        }
                    },
                    {
                        table: 'sys_choice'
                        id: '9a115d4870e7490b8da1a9615379c983'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_state'
                            value: 'issued'
                            language: 'en'
                            dependent_value: 'NULL'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'a85d698d5f934856969033efbfde030d'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_visitor_organization'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: 'aafac2f68cb44c0da9323a0d4c635c99'
                        key: {
                            sys_security_acl: '76b5fec503b9426f821dbfbdc3742023'
                            sys_user_role: {
                                id: 'b9f03bc8ded54324aa80fb9370c5b415'
                                key: {
                                    name: 'itil'
                                }
                            }
                        }
                    },
                    {
                        table: 'question_choice'
                        id: 'ac55af809297422aaa3329e0b5481b82'
                        deleted: true
                        key: {
                            question: {
                                id: '670f421d10004938a945d3bf85e1ee69'
                                key: {
                                    cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                                    variable_set: 'NULL'
                                    name: 'tshirt_size'
                                }
                            }
                            value: 'S'
                        }
                    },
                    {
                        table: 'ua_table_licensing_config'
                        id: 'afd0bb5e312a4b85b860cc4a2fd862b7'
                        key: {
                            name: 'u_guest_wifi_voucher'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'b496c76ec1ad44a1bfc0e0a56435064a'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_visitor_email'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'c3af1c4d177d4cbe8448884cd79356d8'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_request'
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: 'c5ec480a5e4d48fb90120a41e68d7c27'
                        deleted: true
                        key: {
                            cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            variable_set: 'NULL'
                            name: 'office_location'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'c7fb1cb260714bef9992354bf8583b86'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'NULL'
                        }
                    },
                    {
                        table: 'sc_cat_item_category'
                        id: 'ce0764be37a944389668c39736acef20'
                        deleted: true
                        key: {
                            sc_cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            sc_category: 'd721dc7ad1d549249232e5b6b49b89c9'
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: 'd0ba429fdfec42b0b812eed047573012'
                        key: {
                            cat_item: 'dda5b43c0c714d49859c439f0b37e2f0'
                            variable_set: 'NULL'
                            name: 'visitor_organization'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'd3e200c692e24755aa3e6dd2687a089c'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_issued_on'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sc_cat_item_category'
                        id: 'd4775279240d488e9711f6208579d9b3'
                        key: {
                            sc_cat_item: 'dda5b43c0c714d49859c439f0b37e2f0'
                            sc_category: 'd2f7cae4c611227a018ddc481b34e099'
                        }
                    },
                    {
                        table: 'sys_dictionary'
                        id: 'd517c6f5cf3945b5b025748b4533967b'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_requester'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'dbaf4bf443cc4013a99f306d6079cc32'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_expiry'
                            language: 'en'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'e061e5179836430ab21a03725152ae9b'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_business_justification'
                            language: 'en'
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: 'e4c7543bd2dc4fc4b1a9e27a412e5d67'
                        deleted: true
                        key: {
                            cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            variable_set: 'NULL'
                            name: 'special_instructions'
                        }
                    },
                    {
                        table: 'sys_documentation'
                        id: 'e8853fb2297c44aa9a66d28c93346d44'
                        key: {
                            name: 'u_guest_wifi_voucher'
                            element: 'u_state'
                            language: 'en'
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: 'f16e13a42e5747c898e10bc5f325ca04'
                        deleted: true
                        key: {
                            cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            variable_set: 'NULL'
                            name: 'requested_for'
                        }
                    },
                    {
                        table: 'sys_security_acl_role'
                        id: 'f3c5ed7a41724ed49b69b3f4b60b4137'
                        key: {
                            sys_security_acl: '5a0540bd6b344bd29020338f12a2d8c8'
                            sys_user_role: {
                                id: 'b9f03bc8ded54324aa80fb9370c5b415'
                                key: {
                                    name: 'itil'
                                }
                            }
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: 'f5e209847b1a44a1b87c8a4bbca77ece'
                        key: {
                            cat_item: 'dda5b43c0c714d49859c439f0b37e2f0'
                            variable_set: 'NULL'
                            name: 'special_requests'
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: 'f6c571b5efb04be283d4b5224fa31552'
                        key: {
                            cat_item: 'dda5b43c0c714d49859c439f0b37e2f0'
                            variable_set: 'NULL'
                            name: 'business_justification'
                        }
                    },
                ]
            }
        }
    }
}
