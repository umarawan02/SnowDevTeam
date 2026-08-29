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
                    br0: {
                        table: 'sys_script'
                        id: 'ccadaeee22884fdba9e93a12d9b79852'
                    }
                    cs0: {
                        table: 'sys_script_client'
                        id: '4cbdf22f41a04f4d9cd41782b4e3a04c'
                    }
                    package_json: {
                        table: 'sys_module'
                        id: '2bcefea8bd6d437fb1c07d3998de2e99'
                    }
                    src_server_script_ts: {
                        table: 'sys_module'
                        id: '1036a5b70a594f51822891ab0c260008'
                    }
                }
            }
        }
    }
}
