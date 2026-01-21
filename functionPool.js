
import { ref, asyncRef, topicPublishRef } from './tree-builder.js'

const functionPool = {
    'retrieveExceptionDefMetaData': {},
    'commonCreateExceptions': {},
    'createWtException': {
        children: [
            ref('retrieveExceptionDefMetaData'),
            ref('commonCreateExceptions')
        ]
    },
    'retrieveWTPendFiling': {},
    'expireWTPendFiling': {},
    'insertWTPendFilingWithExcep': {
        children: [ref('createWtException')]
    },
    'retrieveWTPendFilingByTPId': {},
    'validateProfile': {},
    'validateWTTaxpayerInformation': {
        children: [ref('validateProfile')]
    },
    'processWTPayments': {
        children: [ref('validateWTTaxpayerInformation')]
    },
    'retrieveUnEmpInsByKeys': {},
    // wage proccesing app
    'insertEmployee': {},
    'retriveEmployeeDtls': {},
    'updateWTEmployee': {},
    'getWTEmployeeWageTypeCount': {},
    'applyWTPreviewEmployeeChanges': {},
    'getTotalBadSsnCount': {},
    'getAllDistributionAmounts': {},
    'getBadSsnDetailsByDln': {},
    'WTWRESUMSearch': {},
    'getNextEmpRowId': {},
    'getNextEmpRowId': {
        children: [
            ref('isWTReturnFilingExists'),
            ref('retrieveWTRtnLiability'),
            ref('retrieveWTPendFilingByTPId')
        ]
    },
    'getWageCount': {
        children: [
            ref('isWTReturnFilingExists'),
            ref('retrieveWTRtnLiability'),
            ref('retrieveWTPendFilingByTPId')
        ]
    },
    'getTotalEmployeeCount': {},
    'retrievePrevEmployee': {},
    'retrievePrevEmpCRUDTotal': {},
    'wageRetrieveEmployeeDetails': {
        children: [
            ref('retrieveWTPendFiling'),
        ]
    },
    'wageRetrieveByEmpName': {
        children: [
            ref("retrieveWTPendFiling")
        ]
    },
    'retrieveWageDetailsForDOL': {
        children: [
            ref("retrieveWTPendFiling")
        ]
    },
    'retrieveWageDetailsForPIT': {
        children: [
            ref("getAllWTReturnFilings")
        ]
    },
    'isWTReturnFilingExists': {},
    'retrieveWTRtnLiability': {},
    'isWTReturnFilingExists': {},
    'getAllWTReturnFilings': {},
    'insertFEDEmployer': {},
    'retrieveFEDEmployer': {},
    'updateFEDEmployer': {},
    'insertFEDEmployee': {},
    'updateFEDEmployee': {},
    'retriveFEDEmployee': {},
    'retrieveLPDetailsLite': {},
    'retrieveEmployerDetailsByDLN': {},
    'retrieveWTReturnFilingByDLN': {},
    'getWTReturnFilingDetailsforOLS': {},
    'retrieveAllWTReturnStatus': {},
    'retrievePaymentData': {},
    //nims-exceptions-app
    'retrieveExceptionDetails': {
        children: [
            ref("retrievePrvwFiling"),
            ref("retrieveWtPayroll"),
            ref("retrieveWTPreviewFiling"),
        ]
    },
    'retrieveExceptionPriority': {
        children: [
            ref("retrievePrvwFiling"),
            ref("retrieveWtPayroll"),
            ref("retrieveWTPreviewFiling"),
        ]
    },
    'commonExpireExceptions': {
        children: [
            topicPublishRef('exceptionsExpireEvent')
        ]
    },
    'commonCreateExpireExceptions': {
        children: [
            topicPublishRef('exceptionsCreateEvent')
        ]
    },
    'retrieveWTPreviewFiling': {},
    'retrieveWtPayroll': {},
    'retrievePrvwFiling': {},
    // NDP600J
    'NDP600JExceptionsCreate': {},
    'NDP600JRetrieveExcps': {},
    'retrieveProcessDefMetaData': {},
    'NDP600JExpireExcps': {}

}

export { functionPool }