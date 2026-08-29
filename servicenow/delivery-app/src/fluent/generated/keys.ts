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
                    package_json: {
                        table: 'sys_module'
                        id: '2bcefea8bd6d437fb1c07d3998de2e99'
                    }
                }
            }
        }
    }
}
