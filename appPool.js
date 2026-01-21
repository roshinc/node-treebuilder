
import { ref, asyncRef } from '../helpers/tree-builder.js'

const applicationPool = {};

applicationPool['nims-wt-pend-process-app'] = {
    name: "nims-wt-pend-process-app",
    type: "app",
    children: [
        ref('retrieveWTPendFiling'),
        ref('expireWTPendFiling'),
        ref('insertWTPendFilingWithExcep'),
        ref('retrieveWTPendFilingByTPId'),
        {
            name: 'WT9000J',
            type: 'ui-services',
            children: [
                {
                    name: 'resolvePend',
                    type: 'ui-service-method',
                    children: [
                        ref('retrieveWTPendFiling'),
                        ref('expireWTPendFiling'),
                        asyncRef('processWTPayments', 'RPWTWR.PFQ'
                        ),
                    ]
                },
                {
                    name: 'getWtPendFilingData',
                    type: 'ui-service-method',
                    children: [
                        ref('retrieveUnEmpInsByKeys'),
                        ref('retrieveWTPendFiling'),
                    ]
                }
            ]
        }
    ]
};

applicationPool['nims-wt-wage-process-app'] = {
    name: "nims-wt-wage-process-app",
    type: "app",
    children: [
        ref('insertEmployee'),
        ref('retriveEmployeeDtls'),
        ref('updateWTEmployee'),
        ref('getWTEmployeeWageTypeCount'),
        ref('applyWTPreviewEmployeeChanges'),
        ref('getTotalBadSsnCount'),
        ref('getAllDistributionAmounts'),
        ref('getBadSsnDetailsByDln'),
        ref('WTWRESUMSearch'),
        ref('getNextEmpRowId'),
        ref('getWageCount'),
        ref('getTotalEmployeeCount'),
        ref('retrievePrevEmployee'),
        ref('retrievePrevEmpCRUDTotal'),
        ref('wageRetrieveEmployeeDetails'),
        ref('wageRetrieveByEmpName'),
        ref('retrieveWageDetailsForDOL'),
        ref('retrieveWageDetailsForPIT'),
        ref('insertFEDEmployer'),
        ref('retrieveFEDEmployer'),
        ref('updateFEDEmployer'),
        ref('insertFEDEmployee'),
        ref('updateFEDEmployee'),
        ref('retriveFEDEmployee'),
        {
            name: "WT4545J",
            type: "ui-services",
            children: [
                {
                    name: 'retrieveData',
                    type: 'ui-service-method',
                    children: [
                        ref('retrieveLPDetailsLite'),
                        ref('retrieveEmployerDetailsByDLN'),
                        ref('retrieveWTReturnFilingByDLN'),
                        ref('retrieveAllWTReturnStatus'),
                    ]
                },
                {
                    name: 'retrieveEmployees',
                    type: 'ui-service-method',
                },
                {
                    name: 'retrievePrevEmployees',
                    type: 'ui-service-method',
                },
                {
                    name: 'searchEmployees',
                    type: 'ui-service-method',
                },
                {
                    name: 'deletePreviewEmployee',
                    type: 'ui-service-method',
                },
                {
                    name: 'insertPreviewEmployee',
                    type: 'ui-service-method',
                },
                {
                    name: 'retrieveNextRowId',
                    type: 'ui-service-method',
                },
                {
                    name: 'searchByEmployeeId',
                    type: 'ui-service-method',
                }
            ]
        },
        {
            name: "WTWAGEUIJ",
            type: "ui-services",
            children: [
                {
                    name: 'retrieveWageDetailsForDOL',
                    type: 'ui-service-method',
                    children: [
                        ref('retrieveWTPendFiling'),
                        ref('retrievePaymentData'),
                        ref('retrieveWTReturnFilingByDLN'),
                        ref('retrieveWTPendFiling'),
                        ref('getAllWTReturnFilings'),
                    ]
                }
            ]
        }

    ]
};

applicationPool['nims-wt-file-process-app'] = {
    name: "nims-wt-file-process-app",
    type: "app",
    children: [
        ref('insertSubmitter'),
        ref('retrieveSubControlInfo'),
        ref('updateSubControlDsn'),
        ref('retrieveSubmissionInfoByDLN'),
        ref('updateSubmitter'),
        ref('retrieveWTSubmissionCtrlDtls'),
        ref('updateNimbBatch'),
        ref('retrieveSubmsnByFileTracker'),
        ref('retrieveSubmissionInfoByEIN'),
        ref('retrieveSubmissionInfoByEINId'),
        ref('insertFileInfo'),
        ref('retrieveFileInfo'),
        ref('updateFileInfo'),
        ref('retrieveWTFileTrackDtlsByDLNS'),
        ref('checkIfDLNExists'),
        ref('checkIfBatchDlnProcessed'),
        ref('insertErrorStats'),
        ref('retrieveAllErrors'),
        ref('retrieveErrorDetailsByFileName'),
        ref('retrieveWTErrorDtlsByFileName'),
        ref('insertWTErrorStatsList'),
        ref('updateFilingStatsAsynch'),
        ref('retrieveWTTestErrorByIDOrDLN'),
        ref('retrieveWTTestErrorDtlsByTPID'),
        ref('insertSubDlnTracker'),
        ref('retrieveSubDlnTracker'),
        ref('WTgetSubmittionDLNList'),
        ref('retrieveSubDlnInfo'),
        ref('processWebFiling'),
        ref('wtSubmit'),
        ref('processWPWFFiling'),
        ref('processWPULFiling'),
        ref('processWCWFFiling'),
        ref('processWCULFiling'),
        ref('mapWTNYS1AdjustRecd'),
        ref('wtnys1jbatchProcessIndvRcdMpr'),
        ref('wtnys1jPromptTaxAchPaymntMpr'),
        ref('wtnys1jwebBulkUploadIndvRcdMpr'),
        ref('mapWTNYS1WebBulkUpload'),
        ref('mapWTNYS1PromptTaxACHPymt'),
        ref('mapWTNYS1JPMCRecord'),
        ref('wtnys45WebBulkUploadMapper'),
        ref('WTNYS45UploadRecordMapper'),
        ref('WTNYS45WebRecordMapper'),
        ref('WTNYS45BatchProcessRecMapper'),
        ref('FSETRecordMapper'),
        ref('wtnys45FsetRecordMapper'),
        ref('wtnys45JpmcRecordMapper'),
        ref('mapWTNYS45WebBulkUpload'),
        ref('mapWTNYS45JPMCRecord'),
        ref('getSeqNmbrNys45'),
        ref('getDSNNys45'),
        ref('mapWTNYS45FedFiler1099'),
        ref('mapWTNYS45FedFilerW2Rec'),
        ref('mapWTNYS45AdjustBO'),
        ref('processWTPromptTaxAdjustments'),
        ref('processWTPromptTaxAdj'),
        ref('wtfeatjPromptTaxACHPayments'),
        ref('wtfeatjUIPaymentResponse'),
        ref('processWTPromptTaxACHPayments'),
        ref('processWTUIPaymentResponse'),
        ref('processWTUIAdjustments'),
        ref('processWTPromptTaxACHAdj'),
        ref('proceesFSETUIAdjust'),
        ref('proceesFSETUIAdjustments'),
        ref('processTaxACHPaymentBatch'),
        ref('verifyNYS1FinishedProcessing'),
        ref('verifyNYS45FinishedProcessing'),
        {
            name: "WT0008J",
            type: "ui-services",
            children: [
                {
                    name: 'getSequenceNmbr',
                    type: 'ui-service-method',
                    children: [
                        ref('getSequence'),
                    ]
                    //notcheched
                },
                {
                    name: 'saveForm',
                    type: 'ui-service-method',
                    children: [
                        ref('fwecfilejSaveForm'),
                    ]
                },
                {
                    name: 'searchFormsByPrimaryInternalTaxpayerId',
                    type: 'ui-service-method',
                    children: [
                        ref('searchFormsByPrimaryIntTpId'),
                    ]
                },
                {
                    name: 'retrieveVoucher',
                    type: 'ui-service-method',
                    children: [
                        ref('retrieveVoucher'),
                    ]
                },
                {
                    name: 'hasActiveVoucher',
                    type: 'ui-service-method',
                    children: [
                        ref('hasActiveWtPayroll'),
                    ]
                },
                {
                    name: 'hasPreExistingWTFiling',
                    type: 'ui-service-method',
                    children: [
                        ref('hasPreExistingWTFiling'),
                    ]
                },
                {
                    name: 'searchFormsByDocumentLocatorNumber',
                    type: 'ui-service-method',
                    children: [
                        ref('searchFormsByDocLctrNmbr'),
                    ]
                },
                {
                    name: 'retrieveAccts',
                    type: 'ui-service-method',
                    //notcheched RetrieveAccts
                },
                {
                    name: 'getPayrollPeriodDueDate',
                    type: 'ui-service-method',
                    //notcheched
                },
                {
                    name: 'getPayrollPeriodDueDate',
                    type: 'ui-service-method',
                    //GetPaymentDueDateFunction
                },
                {
                    name: 'getAllPaymentsForWeb',
                    type: 'ui-service-method',
                    //RetrieveWtPayrollListFunction
                },
                {
                    name: 'retrieveLiablityPeriods',
                    type: 'ui-service-method',
                    //notcheched
                },
                {
                    name: 'retrieveNYS1LiablityPeriods',
                    type: 'ui-service-method',
                    //notcheched
                },
                {
                    name: 'validateProfile',
                    type: 'ui-service-method',
                    //notcheched
                },
                {
                    name: 'retrieveProfile',
                    type: 'ui-service-method',
                    //notcheched
                },
                {
                    name: 'retrieveLPByQuarter',
                    type: 'ui-service-method',
                    //notcheched
                },
                {
                    name: 'getNYS45UIRate ',
                    type: 'ui-service-method',
                    //notcheched
                },
                {
                    name: 'getNYS45PaymentDueDate',
                    type: 'ui-service-method',
                    //notcheched
                },
                {
                    name: 'retrieveOrigNYS1Data',
                    type: 'ui-service-method',
                    //notcheched
                },
                {
                    name: 'getWTPaymentsForWeb',
                    type: 'ui-service-method',
                    //notcheched
                },
                {
                    name: 'removeSavedAcct',
                    type: 'ui-service-method',
                    //notcheched
                }
            ]
        },
        {
            name: "WT0028J",
            type: "ui-services",
            children: [
                {
                    name: 'retrieveWageDetailsForDOL',
                    type: 'ui-service-method',
                    children: [
                        ref('retrieveWTPendFiling'),
                        ref('retrievePaymentData'),
                        ref('retrieveWTReturnFilingByDLN'),
                        ref('retrieveWTPendFiling'),
                        ref('getAllWTReturnFilings'),
                    ]
                }
            ]
        }

    ]
};

applicationPool['nims-exceptions-app'] = {
    name: "nims-exceptions-app",
    type: "app",
    children: [
        ref('retrieveExceptionDetails'),
        ref('retrieveExceptionDefMetaData'),
        ref('commonExpireExceptions'),
        ref('commonCreateExceptions'),
        ref('commonCreateExpireExceptions'),
        ref('retrieveExceptionPriority'),
        ref('NDP600JExceptionsCreate'),
        ref('NDP600JRetrieveExcps'),
        ref('retrieveProcessDefMetaData'),
        ref('NDP600JExpireExcps'),
    ]
};

export { applicationPool }

