function setDefaultModel(model)
{
    model               = model                 || {}
    model.x             = model.x               || 0
    model.y             = model.y               || 0
    model.offset        = model.offset          || {x: 0, y: 0}
    model.text          = model.text            || 'error'
    model.fontSize      = model.fontSize        || height * 0.04
    model.fontFamily    = model.fontFamily      || 'Times New Roman'
    model.color         = model.color           || 'white'
    model.borderColor   = model.borderColor     || 'black'
    model.stroke        = model.stroke          || 0.002 * width
    model.cornerRadius  = model.cornerRadius    || 0 
    model.listening     = model.listening       || false
    
    return model
}