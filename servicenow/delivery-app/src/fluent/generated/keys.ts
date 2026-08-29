import '@servicenow/sdk/global'

declare global {
    namespace Now {
        namespace Internal {
            interface Keys extends KeysRegistry {
                explicit: {
                    bom_json: {
                        table: 'sys_module'
                        id: '29c0276b01ec4be7a51484ed11993845'
                    }
                    'company-tshirt-request': {
                        table: 'sc_cat_item'
                        id: '620491dc1a2343508d724eb18ffaeb6b'
                    }
                    'employee-services-category': {
                        table: 'sc_category'
                        id: 'd721dc7ad1d549249232e5b6b49b89c9'
                    }
                    'facilities-group': {
                        table: 'sys_user_group'
                        id: '2d5200ea138e4c54aec1c4245a5c4157'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '2bcefea8bd6d437fb1c07d3998de2e99'
                    }
                    'tshirt-catalog-trigger': {
                        table: 'sys_hub_trigger_instance_v2'
                        id: '66596f2295e84c2abd52f3a23d96e549'
                    }
                    'tshirt-comment-length-check': {
                        table: 'catalog_script_client'
                        id: '26aca7c14f5940b982d63fec49276415'
                    }
                    'tshirt-else-rejected': {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '09abcc913af64ac7a81f35949db8fc6a'
                    }
                    'tshirt-fulfillment-task': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'd8f7e18259a749da92eda4d33edb3bed'
                    }
                    'tshirt-get-catalog-variables': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'cf944acffdbe4bf99efb27899cef9996'
                    }
                    'tshirt-if-approved': {
                        table: 'sys_hub_flow_logic_instance_v2'
                        id: '8752eee262ed41e8abbe5056b4cbd778'
                    }
                    'tshirt-manager-approval': {
                        table: 'sys_hub_action_instance_v2'
                        id: '8d5e73b8a86641d69429add35cfefa63'
                    }
                    'tshirt-manager-readonly-policy': {
                        table: 'catalog_ui_policy'
                        id: '9f7950c2220f4b62bca99501ba498ecd'
                    }
                    'tshirt-notify-approval-request': {
                        table: 'sysevent_email_action'
                        id: 'ae92f6b99ca549d683e6a987c389a187'
                    }
                    'tshirt-notify-approved': {
                        table: 'sysevent_email_action'
                        id: 'a84a16d0178d4747ae53cc2eb6b5de87'
                    }
                    'tshirt-notify-closed-incomplete': {
                        table: 'sysevent_email_action'
                        id: 'c628a0821e6c4f2e90b0da8084fcfddd'
                    }
                    'tshirt-notify-facilities-new-task': {
                        table: 'sysevent_email_action'
                        id: 'b8c07320f52f4d838858b62980640290'
                    }
                    'tshirt-notify-fulfillment-complete': {
                        table: 'sysevent_email_action'
                        id: '01ab937a0c7f4ca6a184a683caf3fbce'
                    }
                    'tshirt-notify-rejected': {
                        table: 'sysevent_email_action'
                        id: '81d3f8fc86c74a48bd2680771726adba'
                    }
                    'tshirt-notify-submission': {
                        table: 'sysevent_email_action'
                        id: '940086d40de941a9a78755c99aaa29f8'
                    }
                    'tshirt-request-approval-fulfillment-flow': {
                        table: 'sys_hub_flow'
                        id: '3009317c122b49e3aa392401f2fd340a'
                    }
                    'tshirt-ritm-closed-incomplete': {
                        table: 'sys_hub_action_instance_v2'
                        id: 'a3b32dca54254f0aa3eb3fd6ef4f293e'
                    }
                    'tshirt-ritm-work-in-progress': {
                        table: 'sys_hub_action_instance_v2'
                        id: '1e7e4c84f9ea422781f70e69b8294dea'
                    }
                }
                composite: [
                    {
                        table: 'sc_cat_item_catalog'
                        id: '2f23106cb68143ca9176aca426684081'
                        key: {
                            sc_cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            sc_catalog: 'e0d08b13c3330100c8b837659bba8fb4'
                        }
                    },
                    {
                        table: 'question_choice'
                        id: '3302f7f3ae4848ce96e742a77c8109af'
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
                        table: 'catalog_ui_policy_action'
                        id: '42902d5681f940aaacfdddeeccb54930'
                        key: {
                            ui_policy: '9f7950c2220f4b62bca99501ba498ecd'
                            catalog_variable: 'IO:8d64a373a26e4089a61a33e4d1da611e'
                        }
                    },
                    {
                        table: 'question_choice'
                        id: '52bfc964ef7f4f26bcf2483d38c98a80'
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
                        table: 'sc_cat_item_user_criteria_mtom'
                        id: '5c2634637ee64c2e85e87f7178d1a936'
                        key: {
                            sc_cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            user_criteria: '7b8a6927ef732100438236caa5c0fb89'
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: '670f421d10004938a945d3bf85e1ee69'
                        key: {
                            cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            variable_set: 'NULL'
                            name: 'tshirt_size'
                        }
                    },
                    {
                        table: 'question_choice'
                        id: '71735b4f5e81438d8ca02f854c3e8ed8'
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
                        table: 'question_choice'
                        id: '8c1314c34d92467680cdd0e6cb39524f'
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
                        key: {
                            cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            variable_set: 'NULL'
                            name: 'manager_display'
                        }
                    },
                    {
                        table: 'question_choice'
                        id: 'ac55af809297422aaa3329e0b5481b82'
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
                        table: 'item_option_new'
                        id: 'c5ec480a5e4d48fb90120a41e68d7c27'
                        key: {
                            cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            variable_set: 'NULL'
                            name: 'office_location'
                        }
                    },
                    {
                        table: 'sc_cat_item_category'
                        id: 'ce0764be37a944389668c39736acef20'
                        key: {
                            sc_cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            sc_category: 'd721dc7ad1d549249232e5b6b49b89c9'
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: 'e4c7543bd2dc4fc4b1a9e27a412e5d67'
                        key: {
                            cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            variable_set: 'NULL'
                            name: 'special_instructions'
                        }
                    },
                    {
                        table: 'item_option_new'
                        id: 'f16e13a42e5747c898e10bc5f325ca04'
                        key: {
                            cat_item: '620491dc1a2343508d724eb18ffaeb6b'
                            variable_set: 'NULL'
                            name: 'requested_for'
                        }
                    },
                ]
            }
        }
    }
}
